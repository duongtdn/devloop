---
description: Execute and resume sprint work for a single issue. Builds context, plans, and drives a TDD loop (or a scaffold/design flow) through to a merged PR. A resumable phase-based state machine — reads the issue's state file to continue from the last completed phase, pauses at human gates declared up front, and never re-runs a completed phase. Routes the issue to the right workflow from its labels and the user-approved execution plan.
---

You are running **devloop:run**. This is the execution engine: a resumable, phase-based state machine that takes one issue from raw ticket to merged PR.

User may have passed an issue number via `$ARGUMENTS` (e.g. `42`, `#42`). Parse it to `$ISSUE` if present; otherwise `$ISSUE` is unset.

---

## How this skill works

**Phases.** Work moves through named phases. Each phase has a precondition, invokes one or more agents, writes its outputs to files, records its position in the state file, and hands off to the next phase. The full spine:

```
startup → context → [design → gate-design] → plan → gate-plan → build → e2e → review → validate → gate-pr → pending-review → merge
```

Not every phase runs for every issue — the **workflow** (chosen from labels, confirmed at gate-plan) selects which phases are active. The **design** phase is optional: it always runs for the design workflow (and ends there), and runs for a feature/bugfix only when the planner asks for it (a `NEEDS-DESIGN` detour from the plan phase, confirmed at gate-design).

**Resume.** On every invocation, run **Startup** first. Startup either starts fresh from the workflow's entry phase, or — if a state file exists — jumps directly to the recorded phase and continues. **Never re-run a completed phase on resume.** When jumping, go straight to that phase's section.

**Agents communicate only through artifacts.** Agents are stateless specialists. They share nothing in memory — only files (durable) and their final return message (the immediate decision payload run parses). run is the sole writer of the control-plane files (`state/issue-N.md`, `.lock`). The durable cross-agent channel for decisions is `context.md` Zone 2 — an append-only timeline (see [Reference](#contextmd-zone-2--the-shared-timeline)).

**Human gates are declared up front.** At gate-plan the user sees every gate that will fire for this issue. Gates beyond gate-plan only appear if the execution plan includes them.

**Gates are resumable.** A gate panel is built from an agent's return message, which is not durable. So **before presenting any gate, write the structured payload that builds it to the state file's `## Pending gate` block** (the findings table, the critique scorecard, the validation results, the PR body). If a session resumes *at* a gate, rebuild the panel from that block — never re-run the agent to reconstruct it. Clear the block once the gate is resolved.

**The green-check gate is "no *new* test failures," not "zero failures."** Accepted known-failing tests (in `context/devloop-baseline.md`) do not block. See [Known-failing baseline](#known-failing-baseline).

---

## Reference — artifacts

| Path | Scope | Writer | Purpose |
|---|---|---|---|
| `context/sprints/work/issue-N/context.md` | issue | `context` (Zone 1); `designer`/`planner`/`test-writer`/`coder`/`reviewer` + run append Zone 2 | retrieved facts + decision timeline |
| `context/sprints/work/issue-N/design.md` | issue | `designer` | implementation guide / decision doc (when a design phase ran) |
| `context/sprints/work/issue-N/plan.md` | issue | `planner` | ordered tasks + acceptance criteria per task |
| `context/sprints/work/issue-N/test-plan.md` | issue | `planner` | unit scenarios per task + e2e scenarios |
| `context/sprints/work/issue-N/spike/` | issue | `coder` (spike mode) | throwaway proof-of-concept; reference only, safe to delete |
| `context/sprints/state/issue-N.md` | issue | **run only** | phase, position, branch, pr, plan, tasks, log |
| `context/sprints/state/.lock` | global | **run only** | active issue, PID, start time |
| `context/devloop-profile.md` | project | roadmap; **run write-back** | build/test commands + test layout |
| `context/devloop-baseline.md` | project | **run** (on user decision) | accepted-failing tests |

`work/` and `state/` are run's working area for one issue; `profile`, `baseline`, `master-plan`, and `sprint-N` are shared project records. Whether any of these are version-controlled is the user's choice — run neither assumes nor enforces a gitignore policy.

### context.md Zone 2 — the shared timeline

Zone 2 is an **append-only timeline**: agents and gates add entries in execution order; nobody edits or deletes a prior entry. It carries decisions — not just artifacts — between phases. Each entry stands alone (a later reader understands it without re-deriving) and follows the format embedded in the file's Zone 2 header (`### [time] · [author] · [ref]` with `Did` / `Decisions` / `For next` / `Artifacts`).

Agents are not limited to the standard files — a step may create its own supplementary artifact (a generated schema, a scratch analysis, a data sample). When it does, it lists the path under **Artifacts** with a one-line "load this if…" hint, so a later agent (or run) chooses whether to read it instead of everyone loading everything.

**Who appends:**
- `designer`, `planner`, `test-writer`, `coder`, `reviewer` — one entry each when they finish (per their contracts).
- **run** — one entry at each human-gate decision and whenever it changes shared state on the user's behalf: a plan reshaped at gate-plan, findings accepted/declined at gate-review, manual ACs confirmed at gate-validation, a failure baselined.
- `context` owns Zone 1 and leaves Zone 2 empty (with the legend). `test-runner` never writes — it returns buckets to run, which records any baselining.

**Timestamps must be script-derived — never the session clock.** Before invoking an appending agent, and before writing your own gate entry, derive a fresh timestamp and use it as `$NOW`:

```
node -e "console.log(new Date().toISOString())"
```

Node is always available (the bundled milestone MCP requires it); the trailing `Z` is the timezone designator. Pass `$NOW` into the agent invocation — the agent uses it verbatim. **Never** use a date from the prompt or session context; it may be stale.

### State file schema

```markdown
# Issue N — run state

issue: N
workflow: feature | bugfix | design | scaffold
phase: <phase name>
phase_step: -        # multi-pass phases (design/review/validate) only; '-' otherwise
task_index: -        # build-loop position, 0-based; '-' otherwise
branch: <branch>     # '-' until created
base: <base branch>
pr: -                # set once PR created

## Plan (confirmed at gate-plan)
phases: context, [design,] plan, build, e2e, review, validate, gate-pr, merge
gates:  gate-plan ✓, gate-review, gate-validation, gate-pr

## Pending gate        # written before a gate is presented; cleared when resolved
gate: <gate name>
payload: |
  <the structured agent return that builds the gate panel — findings table,
   critique scorecard, validation results, PR body — so a resumed session
   can re-present the gate without re-running the agent>

## Tasks
- [ ] 1. ...

## Log
- <ISO timestamp> <event>
```

Append a `## Log` line at every phase boundary and human decision. Update `phase` / `phase_step` / `task_index` **before** invoking the agents for that step, so a crash resumes correctly.

---

## Startup

Run this section on every invocation, in order.

### S1 — Resolve the active sprint

Determine the active sprint:
- Read `context/sprints/master-plan.md`; find the entry with `- **Status:** active`. Use its sprint number and `Sprint file:`.
- If none is active, fall back to the highest `context/sprints/sprint-N.md` on disk.

If no sprint file can be found:

> No active sprint found — run `/devloop:plan` first.

Stop. Otherwise read the sprint file and extract `$SPRINT_N`, `$SPRINT_FILE`, `$SPRINT_GOAL`, `$REPO`, and the ordered issue checklist.

### S2 — Concurrency guard

Read `context/sprints/state/.lock` if it exists. Determine PID liveness with `kill -0 <pid> 2>/dev/null` (exit 0 = alive).

| Lock | Action |
|---|---|
| live PID | `⚙ run is already in progress for #M (PID alive). Finish or /devloop:abort it first.` → **exit**. (A live process owns the run regardless of `$ISSUE`.) |
| dead PID | `⚠ Found a stale lock from a previous session — clearing it.` → delete `.lock`, proceed. |
| absent | proceed |

### S3 — Read project profile and baseline

Read `context/devloop-profile.md`. If it does not exist:

> `context/devloop-profile.md` not found — run `/devloop:roadmap` to set up build/test commands first, or I'll have to ask for each command as I need it. Continue anyway? (y/n)

On **n**, exit. On **y**, proceed and ask for commands inline when a phase needs one (writing each answer back to the profile).

Read `context/devloop-baseline.md` if it exists (the accepted-failing allowlist). Treat absent as empty.

### S4 — Resolve the target issue and entry point

| Invocation | State file `issue-N.md` | Action |
|---|---|---|
| `run N` | exists | Check GitHub: if PR merged or issue closed → set entry = **merge** (cleanup only). Else set entry = the recorded `phase` (resume). |
| `run N` | none | Entry = the workflow entry phase (fresh). Warn if N is not in `$SPRINT_FILE`, but allow. |
| `run` (no arg) | exactly one in-progress | merged/closed → entry = **merge** (cleanup); else entry = recorded `phase` (resume). |
| `run` (no arg) | multiple in-progress | List them; ask which to resume or abort. |
| `run` (no arg) | none | Pick the first unchecked issue in `$SPRINT_FILE`; entry = workflow entry phase (fresh). |

If no unchecked issue remains:

> All issues in Sprint [N] are checked off. Run `/devloop:review` to close the sprint.

Stop. Set `$ISSUE` to the resolved issue number.

### S5 — Select a starting workflow

Fetch `$ISSUE`'s labels via GitHub MCP (skip if resuming — `workflow` is already in the state file). The workflow is a **best-fit starting template**, not a fixed track — it seeds the default phase set, which the `plan` phase refines and the user finalises at gate-plan. Pick the closest:

| Condition | Workflow | Entry phase |
|---|---|---|
| `area:infra` or `type:chore` implying repo/structure creation | **scaffold** | context |
| `type:bug` | **bugfix** | context |
| `type:question` or `type:decision` | **design** | context |
| all other cases | **feature** | context |

Some issues don't fit a single archetype — "run the suite and review existing code," a spike/investigation, a docs-only chore, or a task that mixes design and build. In those cases pick the nearest template and let the planner propose a **custom phase set** drawn from the named phases; the user shapes the final list at gate-plan. The archetype only decides where to *start*; the actual phases run executes are always the ones confirmed there. (On resume, the confirmed phase list in the state file governs — S5 does not re-run.)

### S6 — Acquire lock and dispatch

Write `context/sprints/state/.lock` with `issue: $ISSUE`, the current PID, and an ISO start time. If no state file exists yet, create `state/issue-N.md` with the schema above (`phase: context`, branch `-`).

Announce and dispatch:

> **▶ run — Sprint [N] · #[ISSUE] [title] · workflow: [workflow]**
> [Starting fresh from context. | Resuming from phase "[phase]".]

Jump to the entry phase. The lock is released on clean exit, at `pending-review`, and at `merge`.

---

## Phase: context

**Active in:** all workflows.

If resuming and `context.md` already exists:

> Context for #[ISSUE] was built [relative time] ago ([build timestamp]). Refresh it from scratch? (y/n)

Compute the relative time from scripts, not the session clock: read the build timestamp recorded in the state log when context was last built, take the current time with `node -e "console.log(new Date().toISOString())"`, and derive the delta from those two values. If no build timestamp was recorded, show the absolute timestamp only.

On **n**, keep the existing file and continue. On **y** (or on a fresh start), invoke `context`.

Invoke **`context`**, passing: `$ISSUE`, `$REPO`, `$SPRINT_GOAL`, the work dir `context/sprints/work/issue-N/`, a one-line profile summary, and `$NOW` (script-derived) for its Zone 2 legend. For **scaffold**, request the light variant (issue + workspace map only). It writes `context.md` Zone 1. Record the build time (`$NOW`) in the state log so a later resume can compute the relative age.

Record the next phase and continue: **design** workflow → `phase: design`; **feature/bugfix** → `phase: plan`; **scaffold** → jump straight to the **scaffold** section.

---

## Phase: design

**Active in:** the **design** workflow (always); **feature**/**bugfix** when the planner raised `NEEDS-DESIGN` from the plan phase. Produces an implementation guide / decision doc (`design.md`) before any task breakdown or code. Multi-pass — `phase_step`: `drafted → [spiked] → critiqued → gated`. *(Human gate: gate-design.)*

**Who decided design is needed:** for the design workflow, the **labels** did (S5 routing). For feature/bugfix, the **planner** did, via `NEEDS-DESIGN` from the plan phase — run never assesses complexity itself. **All design work is delegated to the `designer` agent**; it writes `design.md`, and run holds only the agents' return summaries (recommendation, coverage, criteria, concerns) plus the file path — never the design content — so run's context stays lean.

1. **Draft** (`phase_step: drafted`). Invoke **`designer`** (`mode: design`), passing `context.md`, the issue's acceptance criteria / open questions, and `$NOW`. It writes `design.md` to the work dir against the design rubric, and its return lists any **`NEEDS-PROOF`** assumptions — load-bearing claims that reasoning can't settle. run reads only the summary, not the full document.

2. **Spike** (`phase_step: spiked`, optional). If the draft returned `NEEDS-PROOF` assumptions, present them and offer to validate before going further:

   > The design rests on [n] assumption(s) that need evidence, not reasoning:
   > - [assumption] — would spike: [what to measure]
   >
   > Run a spike to prove these? (all / select / skip)

   For each chosen assumption, invoke **`coder`** (`mode: spike`, pass the `$QUESTION` and `$NOW`). The coder writes throwaway code under `work/issue-N/spike/`, runs it, and returns an evidence-backed `FINDING` — committing nothing. Collect the findings, then re-invoke **`designer`** (`mode: design`, pass `$SPIKE_FINDINGS`) to fold the evidence in and resolve those assumptions. Skip this step entirely when there are no `NEEDS-PROOF` assumptions, or the user declines.

3. **Critique** (`phase_step: critiqued`). Invoke **`designer`** again as a **fresh instance** (`mode: critique`), passing the `design.md` path and `$NOW`. No shared memory → an independent second opinion. It scores the design against the **named criteria** — requirement-coverage, soundness, interface-clarity, alternatives, simplicity, testability, consistency — returning a `pass`/`concern` per criterion, any spike still recommended, and a `sound`/`needs-work` verdict. run collects the scorecard; it does not reason about the design itself.

Record `phase: gate-design`. Continue.

---

## Gate: gate-design

**Active in:** design (always); feature/bugfix when a design phase ran. *(Human gate.)* `phase_step: gated`.

Build this panel from the agents' return summaries and **link** the document — do not load the full `design.md` into run's context to present it; the user opens the file themselves.

> **Design — #[ISSUE]: [title]**
>
> [2–3 line summary of the approach + recommendation, from the designer's return]
>
> Requirement coverage: [k]/[total] addressed [list any gaps]
> Spikes run: [assumption → finding]   ← omit if none
>
> Critique (verdict: [sound | needs-work]):
> | criterion | verdict |
> | requirement-coverage | pass/concern — [issue] |
> | soundness | … |
> | interface-clarity | … |
> | alternatives | … |
> | simplicity | … |
> | testability | … |
> | consistency | … |
>
> Full design: `context/sprints/work/issue-N/design.md`
>
> Approve the design, request changes, run another spike, or skip design and plan directly:

- **Approve** → append a Zone 2 entry (`$NOW`) recording the approved approach and key interfaces (so the planner, coder, and reviewer build to it).
  - **design workflow:** offer to create the proposed follow-up story issues (with `type:feature`/labels), then complete the issue — no branch, no PR: tick its checkbox in `$SPRINT_FILE`, offer to close the GitHub issue (a decision issue has no PR to auto-close it), delete the state file and lock, then go to "Move to next issue?".
  - **feature/bugfix:** record `phase: plan` and continue — the planner will now plan against the approved `design.md`.
- **Request changes** → re-invoke `designer` (`mode: design`) with the feedback, re-critique, re-present.
- **Run another spike** → the user (or an open `concern` on the testability criterion) can request a spike on a specific question; run the spike loop (step 2 above), fold the finding in, re-critique, re-present.
- **Skip design** (feature/bugfix only) → discard the guide, record `phase: plan`, and continue without it. On this path run re-invokes the planner with `$DESIGN_DECLINED: true` so it plans best-effort and does **not** bounce with `NEEDS-DESIGN` again (the user overrode the recommendation).

---

## Phase: plan

**Active in:** feature, bugfix.

Invoke **`planner`**, passing `context.md`, the issue's acceptance criteria and Definition of Done, the profile flags (`$HAS_UNIT_TESTS`, `$HAS_E2E`), `$NOW`, and the `design.md` path **if a design phase ran**. It writes `plan.md` (ordered tasks + per-task acceptance) and `test-plan.md` (unit scenarios per task, e2e per flow; bugfix is root-cause first). If a design guide was provided, the tasks realise that approved approach.

**Design detour.** The decision to design is the **planner's**, not run's: if it judges it cannot responsibly break the work into tasks without an architecture/approach decision first, it returns `NEEDS-DESIGN: [why]` instead of a plan. run does not assess this itself — it simply reacts to the signal: activate the **design** phase above (draft → [spike] → critique → gate-design), and after approval return here and re-invoke the planner with the approved `design.md`. If the user declines at gate-design ("skip design"), run re-invokes with `$DESIGN_DECLINED: true` — the planner then plans best-effort and must not return `NEEDS-DESIGN` again (no loop).

Record `phase: gate-plan`. Continue.

---

## Gate: gate-plan

**Active in:** feature, bugfix. *(Human gate.)*

### Build the execution plan

run owns the phase list. Start from the workflow default (the table in [How this skill works](#how-this-skill-works)), then adjust to what the planner actually produced:
- `test-plan.md` has e2e scenarios **and** the profile has an `e2e-test` command → include **e2e**. Otherwise drop it.
- DoD includes "Code reviewed" → include **review**. The issue has acceptance criteria → include **validate**.
- Count build tasks from `plan.md`.

When the issue doesn't match its archetype, compose the phase set directly from the named phases to fit the real work — e.g. a "test + review existing code" task is `build`-less (review + validate only); an investigation/spike is `context → plan → gate-plan` then done. The phase list can be any sensible subset/order of the named phases — that is what makes the workflow dynamic while keeping every phase predictable. (The design phase is not composed here — it sits *upstream* of this gate and is reached via the planner's `NEEDS-DESIGN` detour or the design workflow.)

Then compute which **gates** will fire: `gate-plan` (now), `gate-review` (if review is active), `gate-validation` (if any acceptance criterion is manual / not test-backed), `gate-pr` (always for code workflows).

### Present

> **Execution plan for #[ISSUE] — [title]  ([workflow])**
>
> | Stage | What |
> |---|---|
> | Code | TDD loop × [N] tasks (test → code per task) |
> | E2E | [scenario list] |  ← omit row if e2e not active
> | Review | diff review + findings |  ← omit if not active
> | Validate | [K] acceptance criteria ([M] need manual check) |
> | PR | [branch] → [base] |
>
> Gates I'll stop at:
> ① now — approve this plan + test strategy
> ② after review — approve findings before fixes  ← list only active gates
> ③ after validate — verify [M] ACs manually
> ④ before PR — approve PR content
>
> Approve, or reshape (e.g. "skip e2e", "skip review", "this is a design task"):

Apply any reshaping the user asks for (drop/add a stage, switch workflow). Re-present until approved. The user reshaping the workflow is the flexibility valve — honor it.

### On approval

1. Create the branch: `feat/issue-N-<slug>` (feature) or `fix/issue-N-<slug>` (bugfix), from `$base`. `<slug>` is the kebab-cased, truncated issue title.
2. Write the confirmed `phases:` and `gates:` lines to the state file; mark `gate-plan ✓`.
3. Record `phase:` = first active execution phase (`build`, or `validate`/`gate-pr` if build was dropped).

(The design workflow does not reach this gate — it ends at [gate-design](#gate-gate-design). Reshaping a feature to "this is a design task" here switches it to the design workflow and routes it through the design phase.)

Continue to the first active execution phase.

---

## Phase: build

**Active in:** feature, bugfix. The TDD loop, repeated per task in `plan.md`. `task_index` is the 0-based position.

For the task at `task_index`:

1. **Write tests.** Invoke **`test-writer`** with the `test-plan.md` path, the current task, and the `design.md` path **if a design phase ran** (so the tests assert the approved interfaces). It writes the specified failing unit tests. It does not run them.

2. **Code.** Invoke **`coder`** with the task, `plan.md`, `context.md`, the `design.md` path **if a design phase ran**, `$NOW`, and the profile checks it should run (the `build`/`unit-test`/`typecheck`/`lint` commands the profile actually has). It makes the failing tests pass and commits **only when all provided checks pass**. Building to the approved design directly is what makes the reviewer's conformance check pass by construction.

   **Missing-command round-trip.** The coder runs only the commands it is given and never guesses. If it needs a check the profile doesn't provide (e.g. there's no `typecheck` command but the code is typed), it returns `RESULT: blocked` with a `MISSING: <check>` line instead of committing. On that signal, run does not count an attempt — it asks the user:

   > The coder needs a **[check]** command, which isn't in the profile. What command runs it? (or `none` if this project has no [check]):

   Write the answer back to `context/devloop-profile.md` (see [Profile write-back](#profile-write-back)) — or record `none` so it isn't asked again — then re-invoke the coder with the updated check set **and the `$ABSENT` list** (checks the user marked `none`), so the coder proceeds without re-flagging them. This is distinct from the 3-attempt escalation below, which is for tests that won't pass.

3. **Run tests.** Invoke **`test-runner`** (unit mode) with the test file, the full-suite command, and the baseline path. It returns three buckets — **new / accepted / pre-existing**. Handle them per [Known-failing baseline](#known-failing-baseline). `new` failures block; resolve before continuing.

4. Mark the task `[x]`, increment `task_index`, append a log line.

**Escalation.** If `coder` cannot make the tests pass after **3 attempts** on the same task, stop the loop:

> Stuck on task [i] "[task]" after 3 attempts. Last failure:
> ```
> [output]
> ```
> How do you want to proceed? **retry** / **edit the plan** / **accept as known-failing** (needs a tracking issue) / **abort** (`/devloop:abort`)

When all tasks are `[x]`, record `phase:` = next active phase (`e2e` if active, else `review`). Continue.

---

## Phase: e2e

**Active in:** feature, bugfix — only if `test-plan.md` has e2e scenarios. Skipped silently otherwise.

If the profile has no `e2e-test` command but the plan expects e2e:

> The plan includes E2E scenarios but the profile has no `e2e-test` command. Provide one now (I'll save it), or skip E2E for this issue? (command / skip)

Invoke **`test-writer`** to write the Playwright tests for the scenarios, then **`test-runner`** (full mode) — it starts the `dev-server` from the profile, runs the e2e suite, and returns the three buckets. Handle failures per [Known-failing baseline](#known-failing-baseline).

Record `phase: review`. Continue.

---

## Phase: review

**Active in:** feature, bugfix. Both reasoning passes are **delegated to agents** so run holds only the structured verdicts, not the diff. `phase_step` tracks position (`reviewed` → `critiqued` → `gated`). *(Human gate: gate-review.)*

1. **Review** (`phase_step: reviewed`). Invoke **`reviewer`** (`mode: review`) on the diff. It returns findings across four dimensions — correctness bugs, DRY violations, reuse/simplification, consistency — each classified `blocker` or `refactor`. **If a `design.md` exists** for this issue, pass its path: the reviewer also checks the implementation conforms to the approved design (interfaces, approach, module boundaries), so the design actually governs the code rather than just preceding it.

2. **Critique** (`phase_step: critiqued`). Invoke **`reviewer`** again as a **fresh instance** in `mode: critique`, passing the findings from pass 1. Because it shares no memory with pass 1, it is an independent second opinion: for each finding it returns `uphold` or `drop` with one-line reasoning. run does this reasoning *nowhere itself* — it just collects the two structured returns.

3. **gate-review** (`phase_step: gated`). Merge the two passes and present grouped:

   > **Review — #[ISSUE]**
   >
   > **Upheld ([n])** — both passes agree; will be addressed
   > - [blocker|refactor] [file:line] [finding]
   >
   > **Dropped ([n])** — critique judged these not worth acting on: [reasoning]
   > **Disputed ([n])** ⚠ — review flagged, critique disagreed (or vice-versa); your call
   >
   > Override any verdict, or confirm to proceed:

   "Disputed" = the two passes disagree; surface these for the user, who has final say on everything.

4. **Apply.** Confirmed **blocker** findings trigger another build pass — **the `coder` agent in `fix` mode (no new tests written)** plus `test-runner` to verify. Confirmed **refactor** findings are offered to the user; each accepted one is likewise applied by the **`coder` in `fix` mode** and verified by `test-runner` (unit). There is no separate refactor agent — refactoring is the coder's job. If any refactor was applied and e2e is active, re-run `test-runner` (full) to catch regressions.

Append a Zone 2 entry (`$NOW`) recording the gate outcome — which findings the user upheld, dropped, or overrode — so validation sees the human decision.

Record `phase: validate`. Continue.

---

## Phase: validate

**Active in:** feature, bugfix. *(Human gate: gate-validation, only if manual ACs exist.)*

Cross-check the issue's acceptance criteria and Definition of Done against what was delivered. `phase_step`: `auto-checked` → `gated`.

- **Automated ACs / DoD** (test-backed): mark satisfied from the latest `test-runner` results and the completed review. "PR merged to main" cannot be checked yet — leave it.
- **Manual ACs** (user-visible behavior with no test): present at **gate-validation**:

  > **Validate — #[ISSUE]**
  >
  > Verified automatically:
  > - [x] [criterion] (unit) · [x] [criterion] (e2e) · [x] Code reviewed
  >
  > Please verify manually:
  > - [ ] [criterion — e.g. "error toast appears on wrong password"]
  >
  > Confirm each is met (y / list the ones that fail):

If any AC or required DoD item is unmet:

> [k] of [total] criteria are unverified: [list]. Create the PR anyway? (y/n)

**Block with override** — proceed only on explicit `y`. On `n`, return to the relevant phase (build for a failed behavior, e2e for a failed flow). Re-entering an earlier phase re-runs the phases after it that are affected by the change (e.g. a build fix re-runs review and validate); unaffected completed phases are not redone.

Append a Zone 2 entry (`$NOW`) recording the validation outcome — which criteria were confirmed, which the user waived on override.

Record `phase: gate-pr`. Continue.

---

## Gate: gate-pr

**Active in:** feature, bugfix. *(Human gate.)*

Push the branch. Create the PR via GitHub MCP:
- Title: the issue title.
- Body: `Closes #[ISSUE]`, a one-paragraph summary from `plan.md`, and the validation checklist.

Present:

> **PR ready — #[ISSUE]**
> [branch] → [base]
> [title]
>
> [body preview]
>
> Approve to open the PR for review? (y / edit)

On approval, record `pr:` = the PR number and `phase: pending-review`. Continue.

---

## Phase: pending-review

**Active in:** feature, bugfix. The hand-off point.

Record `phase: pending-review` and `pr:`. **Delete the lock** — run is no longer active; the PR is in human/CI hands. Exit cleanly:

> **#[ISSUE] → PR #[pr] is open and awaiting review.**
>
> - Review it: `/devloop:pr-review [pr]`
> - Address comments: `/devloop:pr-fix [pr]`
> - **No CI:** once approved, run `/devloop:run [ISSUE]` to merge and clean up.
> - **With CI:** once approved, CI merges and closes the issue via `Closes #`; then run `/devloop:run [ISSUE]` to finish sprint cleanup.

Stop.

---

## Phase: merge

**Active in:** feature, bugfix. Reached on resume when `phase: pending-review` (or directly from Startup S4 when the PR is already merged / issue closed).

Re-check the PR state via GitHub MCP:

| PR state | Action |
|---|---|
| merged | skip merge → cleanup |
| open, approved | rebase if behind base, then merge |
| open, not approved | `PR #[pr] is not approved yet — run /devloop:pr-review and /devloop:pr-fix first.` → exit |

**Merge method:** use the repo's single allowed method if only one is enabled; if several are, ask once:

> Merge #[pr] by **squash / rebase / merge commit**?

If a rebase hits a conflict, surface it and stop — ask the user to resolve manually or `/devloop:abort`.

**Cleanup** (runs whether we merged or detected an existing merge):
1. Tick the issue's checkbox `[x]` in `$SPRINT_FILE`.
2. Delete `context/sprints/state/issue-N.md`.
3. Delete `context/sprints/state/.lock`.
4. Leave `work/issue-N/` in place (gitignored, useful for reference).

> ✅ #[ISSUE] done — PR #[pr] merged, issue closed, sprint file updated.
>
> Move to the next issue? (y/n)

On **y**, return to **Startup S4** as the no-arg case (pick the next unchecked issue). On **n**, exit cleanly.

---

## Scaffold workflow

**Phases:** context (light) → scaffold → profile write-back → done. No branch, no tests, no PR.

After the light context phase, invoke **`scaffolder`** with the issue, `$REPO`, and the intended structure. It creates the repo (if needed), bootstraps the project structure (`api/`, `web/`, `types/`, etc.), and commits directly to the base branch. The scaffolder checks for existing files/dirs before creating, so a resumed scaffold (crash before profile write-back) doesn't duplicate or clobber what the previous run already created.

Then capture what the scaffold established — build/test/lint commands, test layout, frameworks — and run [Profile write-back](#profile-write-back) so later issues inherit them.

> ✅ Scaffold complete for #[ISSUE]. Project profile updated with the new commands.
>
> Move to the next issue? (y/n)

Tick the checkbox, delete the state file and lock as in merge cleanup, then handle the next-issue prompt.

---

## Known-failing baseline

`context/devloop-baseline.md` is the committed allowlist of accepted-failing checks. The green-check gate is **no `new` failures**, not zero failures.

`test-runner` reads the baseline and returns failures in three buckets:

| Bucket | Meaning | run's action |
|---|---|---|
| **new** | failing + attributable to this task | **block** — surface immediately, resolve before continuing |
| **accepted** | failing + matches a baseline entry | don't block — report the count |
| **pre-existing** | failing + not baselined + not from this task | dedupe vs open GitHub issues, then offer per group: **file issue** / **baseline it** / **ignore** |

**Surfacing `new` failures:**

> [k] new test failure(s) introduced by this task:
> - [test] — [one-line reason]
>
> **fix** (keep iterating) / **accept as known-failing** (needs a tracking issue) / **abort**

**Accept as known-failing** — require a tracking issue (reference an existing one or create a `type:bug` issue now), then append to `context/devloop-baseline.md`:

```markdown
- check: unit | e2e
  test: <test id>
  reason: <why accepted>
  tracking: #<issue>
  added: <$NOW>
  added-by: issue #[ISSUE]
```

Use a script-derived `$NOW` (see the Zone 2 timestamp rule) for `added:`, and append a Zone 2 entry recording that the failure was baselined and why.

**Auto-clean.** If `test-runner` reports a baselined test now **passing**:

> A baselined test now passes: [test] (tracking #[t]). Remove it from the baseline and close #[t]? (y/n)

On **y**, remove the entry and close the tracking issue with a comment. Also, at Startup, drop any baseline entry whose `tracking:` issue is already closed.

---

## Profile write-back

`context/devloop-profile.md` is machine-maintained. run updates it in two cases:

1. **Scaffold** established the project's commands → write them all.
2. A task **filled a previously-empty field** (e.g. the first test script was added) → offer to record it.

Do **not** diff or rewrite on every commit. Before writing, confirm:

> The project now has a [field] command: `[command]`. Save it to the profile so future runs use it? (y/n)

Write only the confirmed fields; never overwrite an existing non-empty field without asking.

---

## Exception handling

- **Agent returns `ERROR:`** — surface the message; offer **retry** / **skip** (where safe) / **abort**.
- **Coder stuck after 3 attempts** — escalate per the build phase.
- **New test failures** — block per the baseline section.
- **Rebase/merge conflict** — surface, stop, ask the user to resolve or `/devloop:abort`.
- **GitHub MCP failure** — report; retry once on the user's go-ahead, otherwise note it and continue where the step is non-critical (e.g. an optional label), or exit where it is critical (PR creation, merge).
- **Crash mid-run** — leaves the lock and state file. The next invocation's stale-PID check clears the lock; the recorded `phase` resumes the work.
