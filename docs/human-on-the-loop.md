# Human-on-the-loop — consolidated design

Design reference for extending devloop from a purely **human-in-the-loop** sprint lifecycle
to one that also supports **human-on-the-loop**: autonomous execution with human oversight
concentrated into review conversations, not inline gates.

Status legend: **[done]** already implemented · **[new]** to build · **[change]** modify existing.

> **Implementation status: fully implemented (2026-07-10).** The [new]/[change] tags below record what
> each piece was at design time; all of them have landed (`run --auto`, `sprint`, `replan`,
> scope-aware `review`, `plan-spec.md`, the `✓accepted` marker, `status` states, CLAUDE.md).
>
> **Revision (2026-07-11) — delivery decoupled from autonomy.** The PR became a separate axis. `run`
> now has **two orthogonal axes**: **autonomy** (`human | auto`) and **delivery** (`direct | pr`). The
> old `--merge` flag / `auto+merge` mode are **gone**. `--auto` now **runs to completion (merges)** rather
> than halting at a PR; the default delivery is **direct** (merge into base locally, no PR). A GitHub PR
> is opt-in with `--pr` — only the **human + pr** cell halts for review before merge. `sprint` drives
> plain `run --auto` (direct, PR-less). Where this doc says `run --auto` "halts at the open PR" or refers
> to `--auto --merge`, read it through this revision; the authoritative behavior is in `skills/run/SKILL.md`
> ([Autonomy and delivery]) and CLAUDE.md.
>
> **Revision (2026-07-11) — sprint drives each issue via an isolated subagent.** `sprint` now spawns a
> fresh Agent-tool subagent per issue to invoke `run --auto`, instead of invoking it inline via the Skill
> tool. `run --auto` has no human gates to preserve mid-conversation and logs every decision to disk
> (`context.md` Zone 2, the state file), so nothing is lost by isolating each issue's execution — and it
> keeps `sprint`'s own context flat regardless of sprint length instead of accumulating every phase and
> agent call of every issue. `sprint` still cross-checks the sprint file's checkbox on disk rather than
> trusting the subagent's report alone. See `skills/sprint/SKILL.md` Step 3.

---

## 1. The core idea

Today, human interaction lives *inside* execution as inline gates (`gate-plan`, `gate-review`,
`gate-pr`, …). This design **relocates** that interaction: execution becomes autonomous, and the
human engages afterward through a dedicated **review conversation** — at task scope or sprint scope.

Two complementary modes ("loops"):

| Loop | Skill | Who drives | Human relationship |
|---|---|---|---|
| **Inner loop** (fast) | `run --auto`, `sprint` | AI runs autonomously to completion (merges); every decision + reasoning logged | human-**on**-the-loop (reviews after, in the outer loop) |
| **Outer loop** (slow) | `review` (task \| sprint) | human + AI in conversation | human-**in**-the-loop |

Terminology: **inner loop / outer loop** (established DX vocabulary, and it fits *devloop*). The inner
loop runs many times inside one outer-loop cycle.

Design principle carried throughout: **the AI never fakes a human judgment it can't make.** Where
reasoning can't safely settle a decision, the inner loop stops and logs a blocker rather than guessing;
the human resolves it in the outer loop.

---

## 2. Skill surface

| Skill | Role | Status |
|---|---|---|
| `run` | **inner loop** — execute one issue. `--auto` autonomous (runs to completion), gated by default. Delivery `direct` (default, local merge) or `--pr`. | **[done]** |
| `run --auto` | inner loop that runs to completion, merging (used by `sprint`). Was `--auto --merge` at design time — see the 2026-07-11 revision. | **[done]** |
| `sprint` | **inner loop, sprint scope** — thin orchestrator: run every issue autonomously to the end. | **[new]** |
| `review` | **outer loop** — scope-aware conversation: `review <issue>` (task) / `review` (sprint). | **[change]** expand |
| `replan` | amend the active sprint (add / drop / reorder / re-scope / create rework issue). | **[new]** |
| `plan` | create a sprint (greenfield wizard). | **[change]** factor spec out |
| `plan-spec.md` | shared spec: issue-body template + DoD-by-type + sprint-file line format. | **[new]** |
| `pr-review` / `pr-fix` | **code** altitude (line-level correctness, inline comments). Unchanged. | — |
| `status` | read-only snapshot. May add "awaiting review / accepted" states. | **[change]** minor |
| `roadmap` / `backlog` | vision / backlog authoring. Unchanged; `review` feeds them. | — |
| `abort` | clean stop of a run. Unchanged. | — |

New artifacts: `sprint`, `replan`, `plan-spec.md`, and the **`✓accepted`** marker (§6).

---

## 3. Inner loop — `run --auto` **[done]**

Autonomous single-issue execution. Already implemented in `skills/run/SKILL.md`:

- Mode set by `--auto` on invocation, persisted as `autonomy:` in the state file, governs on resume.
- **Gates don't stop** — at each gate, run applies a decision rule, acts, and logs the decision *and its
  reasoning* to `context.md` Zone 2 (attributed to `run (auto)`).
- **Runs to completion — it merges** (per the 2026-07-11 revision; at design time `--auto` halted at
  `pending-review` and only `--auto --merge` merged). Default delivery is **direct**: the branch merges
  into the base locally, no PR. The human reviews the shipped work afterward in the outer loop.
- **Prefer proof over guessing** — where a load-bearing choice can be settled empirically, run a spike
  rather than reason to an answer (all `NEEDS-PROOF` spikes + any spike the critique still recommends).
- **Boundary / stop-the-line** — stops and logs a blocker (never fakes a judgment) on: coder stuck after
  3 attempts, unfixable `new` test failures, a design still `needs-work` after one iteration, a
  rebase/merge conflict, an agent `ERROR:`, or a manual-workflow issue.

### Delivery — `direct` (default) vs `--pr` **[revised 2026-07-11]**

Delivery is a second axis, orthogonal to autonomy:

- **direct** (default) — the branch merges into the base **locally**, no PR. `--auto` is the standing
  authorization to merge without a separate human approval (consistent with the solo-dev CI-less path,
  where you can't approve your own PR). This is what `sprint` uses.
- **`--pr`** — open a GitHub PR (for a PR-gated CI check, an audit trail, or a collaborator). In **human**
  mode the run **halts at the open PR** for review (`pr-review` / `pr-fix`, then re-run to merge) — this
  is the only cell that halts before merge; in **auto** mode the PR is created and **merged through**.

The old `--auto --merge` flag is gone: an auto run merges by virtue of being auto, and whether that merge
is local or via a PR is the delivery axis. Everything else about the merge phase is unchanged
(rebase-if-behind, repo merge method, conflict → stop).

---

## 4. Inner loop, sprint scope — `sprint` **[new]**

A **thin orchestrator over `run`**, not a new engine. It automates the "move to the next issue?" step
that `run` already asks, in `--auto` mode (direct, PR-less), across the whole sprint.

**Model M1 (merge-as-you-go):** each issue's branch merges into `main` locally (no PR) as it completes,
so later issues build on real, present code (honoring the execution order `plan` computed: infra → api →
web). `main` advances autonomously during the sprint; the **milestone-end release tag** (§7) decouples
release from that.

Flow:
1. Resolve the active sprint (same as `run` Startup S1).
2. Walk the sprint file's issue list **in execution order**. For each unchecked issue, invoke `run`
   in `--auto` mode.
3. **Resume-in-progress first:** on (re)invocation, if an issue is mid-flight (state file present),
   resume it before picking the next unchecked one — inherits `run`'s existing resume logic.
4. **Stop on any inner-loop blocker.** If `run` halts (coder stuck, unfixable failure, manual issue,
   conflict, `ERROR:`), `sprint` **stops and reports** — it does *not* skip ahead, because later issues
   may depend on the blocked one.
5. When all issues are checked off, stop and hand off:
   > Sprint N executed — run `/devloop:review` to walk through and accept each task.

`sprint` owns only sequencing + the sprint-level announce/summary/handoff. Per-issue lock, state, and
cleanup stay in `run`.

---

## 5. Outer loop — `review` (scope-aware) **[change]**

`review` becomes the conversational review skill, at two scopes. The two scopes share a **per-task
conversation core**; the sprint scope wraps it with the existing close ceremony.

### `review <issue>` — task review **[new capability]**
The review conversation for a shipped task. Two arrival paths: `run --auto <issue>` (merged already, no
PR) → `review <issue>`; or the halt-at-PR path `run --pr <issue>` (human) → open PR → `review <issue>`.
- AI **explains** the task (what was built, key decisions — from `context.md` Zone 2 / plan / diff).
- Human **demos**, asks questions, gives feedback.
- Outcome:
  - **accept** → if a PR is still open (the `--pr` human path), trigger `run`'s **merge** phase (merge +
    cleanup + close); if the task already merged (the `--auto` / direct common case), there is nothing to
    merge. Either way, mark **`✓accepted`** (§6). *(Merge stays in `run` — it owns lock + cleanup.)*
  - **request rework** → create a **new linked issue** via `replan` (§8); the original stays shipped.
- May **spawn backlog items** and **adjust the sprint plan** — but only via `replan` / `backlog`,
  never by editing tracking files directly.
- No milestone close at task scope.

### `review` (no arg) — sprint review **[expanded]**
- Walk each **un-`✓accepted`** issue using the per-task conversation above. Issues already accepted at
  task scope are shown as "already reviewed — skipped."
- Then the **existing** reconcile → retrospective → tag → milestone-close ceremony (current `review`
  Steps 2–5) as the finale.
- Under M1, most issues are already merged/closed at execution, so sprint review is primarily a
  **demo + acceptance** pass; "reconcile" handles the exceptions.

### Altitude note
`review` is **product/acceptance** altitude ("is this the right thing? show me"). `pr-review` is **code**
altitude ("is the code sound line-by-line"). The inner loop already ran the `reviewer` agent
autonomously, so `pr-review` remains an optional human deep-dive; `review` can hand off to it.

---

## 6. The `✓accepted` marker **[new]**

**Why not "closed = reviewed":** under M1, `sprint` merges each PR with `Closes #N`, so GitHub
**auto-closes every issue at execution — before any human review**. So closed means *merged*, not
reviewed. Human-acceptance and closed-state are orthogonal facts; acceptance needs its own signal.

**The marker:** when a task is human-accepted (task or sprint scope), annotate its line in the sprint file:

```
- [x] #44 — Add session persistence (area:infra) ✓accepted 2026-07-10
```

- `[x]` = executed/merged (written by `run`).
- `✓accepted <date>` = human signed off (written by `review`).

Sprint review **walks only issues without `✓accepted`**. The sprint file is already the source `review`
and `status` read, so this adds no GitHub calls. *(Optional: mirror as a `status:accepted` label for
GitHub-side visibility — sprint file stays authoritative.)*

`status` may surface an "awaiting review" state (merged/closed but not yet `✓accepted`).

---

## 7. Release tag at milestone end **[change]**

Under M1 `main` advances continuously, so decouple *release* from *integration*: make the annotated tag
(currently `review` Step 4, optional) a **standard step at sprint close** — cut `sprint-N` / `v0.N.0` at
the milestone boundary as a stable, named release point. Advancing `main` no longer implies releasing.

---

## 8. `replan` — amend the active sprint **[new]**

All sprint-plan changes route through `replan` (never edited ad hoc by `review`) so issue creation and
tracking-file updates stay consistent. Chosen as a **new thin skill** rather than a mode of `plan`
because the two have different *shapes*: `plan` is a one-time greenfield wizard; `replan` is an ad-hoc,
idempotent transaction invoked repeatedly (often from `review`).

Scope: **add** an issue · **drop** an issue (clear milestone / backlog / close) · **reorder** execution ·
**re-scope / split** an issue · **create a rework issue**.

Consistency comes from **shared spec + shared agents**, not from being the same skill:
- Reads **`plan-spec.md`** (§9) for the issue-body template, DoD-by-type, and sprint-file line format.
- Reuses the `issue-selector` agent (e.g. to pull a backlog item into the sprint).
- Updates the sprint file + GitHub the same way `plan` does.

### Rework issues — lightweight cross-link
Rework = a **new issue** in the sprint, not a re-run of the original (which stays shipped/closed):
- New issue body carries `Rework of #N`.
- `replan` posts a backlink comment on #N: `Rework tracked in #M`.
- Both remain flat sprint issues under the milestone (no sub-issue hierarchy) — enough for history
  tracing without disturbing the flat sprint/milestone model `status`/`review`/`plan` assume.

---

## 9. `plan-spec.md` — shared format spec **[new]**

Factor the drift-prone knowledge currently inline in `plan` Step 3 into one source of truth:
- the **issue-body template** (`## What` / `## Acceptance Criteria` / `## Definition of Done`),
- the **DoD-by-type** rules (feature/bug/question/decision/chore × profile test flags),
- the **sprint-file line format**.

Both `plan` (create) and `replan` (amend) read it. One place defines "what a sprint issue looks like";
two skills apply it to different lifecycles. `plan` loses the inline duplication; net complexity per
skill drops even though we add a file.

---

## 10. Key flows

**Fully autonomous sprint, then review:**
```
plan            → sprint scoped, issues + milestone + order
sprint          → run --auto per issue, in order, merging to main locally (no PR)
                  (stops + reports on any blocker)
review          → walk each un-accepted task: demo · accept (✓) / rework (→ replan new issue)
                  → reconcile · retro · tag · close milestone
```

**Task-by-task (tighter oversight):**
```
run --auto <issue>   → run to completion, merges locally (no PR)
review <issue>       → demo · accept → ✓accepted   |   rework → replan new issue
… repeat …           (to review *before* merge instead, use `run --pr <issue>` → open PR → review → merge)
review               → sprint review skips ✓accepted; ceremony on the rest
```

**Rework loop:** `review` (reject) → `replan` (new linked issue in sprint) → `run`/`sprint` executes it →
reviewed again. History traced via `Rework of #N` ↔ `Rework tracked in #M`.

---

## 11. Recovery & resume

- `run` is a resumable state machine: state file records `phase`/`task_index`/branch/pending-gate; lock
  carries a PID; a dead PID auto-clears on next invocation. A session dying mid-issue loses nothing —
  re-invoking resumes from the recorded phase.
- `sprint`'s state is the sprint file's checkboxes + the in-progress issue's state file. Re-invoking
  `/devloop:sprint` resumes the in-progress issue first, then continues the list. **Requirement:** resume
  in-progress before selecting the next unchecked issue.
- So a paused long run or sprint recovers with a single re-invocation.

**Out of scope:** having the harness auto-resume a usage-limit-interrupted session. A skill can't catch
the limit event (it terminates the turn below the plugin). The building blocks exist (idempotent resume +
schedulable re-invocation via a `/schedule` routine), but wiring auto-resume is not part of this design.

---

## 12. Complexity check

The design is largely **additive and reuses existing machinery**:
- `sprint` is a thin loop over `run`; no new execution engine.
- Sprint review = per-task conversation + the already-written close ceremony.
- `replan` stays lean by sharing `plan-spec.md` + agents; `plan` gets *simpler* (spec factored out).
- The only genuinely new state is the `✓accepted` marker (one annotation in a file already read).

Watch items: keep `sprint` a pure orchestrator (don't reimplement `run`); keep `review`'s per-task core
factored so task and sprint scopes share it; keep `plan`/`replan` reading one spec so formats never drift.
