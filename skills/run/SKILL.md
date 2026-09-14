---
description: Execute and resume sprint work for a single issue. Builds context, plans, and drives a TDD loop (or a scaffold/design/manual flow) through to merged code — by default merged into the base locally with no PR; pass `--pr` to deliver through a GitHub PR instead. A resumable phase-based state machine — reads the issue's state file to continue from the last completed phase, pauses at human gates declared up front, and never re-runs a completed phase. Routes the issue to the right workflow from its labels and the user-approved execution plan. Pass `--auto` for human-on-the-loop execution — no gates stop the run; run reasons to the best decision at each one, logs every decision and its reasoning for later review, runs to completion (merging), and halts only when it hits something it can't decide safely; the human then reviews the shipped work in the outer loop (`/devloop:review`). With `--pr`, a human-mode run halts at the open PR for review while an auto run creates the PR and merges it through.
---

You are running **devloop:run**. This is the execution engine: a resumable, phase-based state machine that takes one issue from raw ticket to merged code (locally by default, or via a GitHub PR with `--pr`).

Parse `$ARGUMENTS`:
- an issue number (e.g. `42`, `#42`) → `$ISSUE` if present; otherwise `$ISSUE` is unset.
- the `--auto` flag (in any position) → `$AUTONOMY = auto`; otherwise `$AUTONOMY = human`. This selects human-in-the-loop (default) vs human-on-the-loop execution — see [Autonomy and delivery](#autonomy-and-delivery).
- the `--pr` flag (in any position) → `$DELIVERY = pr`; otherwise `$DELIVERY = direct`. This selects how the branch lands: **direct** merges it into the base locally with no GitHub PR (the default — a solo dev rarely needs a PR review, and the real review is the outer loop); **pr** opens a GitHub PR. See [Autonomy and delivery](#autonomy-and-delivery).

---

## How this skill works

**Phases.** Work moves through named phases. Each phase has a precondition, invokes one or more agents, writes its outputs to files, records its position in the state file, and hands off to the next phase. The full spine:

```
startup → context → [design → gate-design] → plan → gate-plan → build → e2e → review → validate → deliver → merge
                                                  ↘ MANUAL → gate-manual → done

deliver = direct (default): gate-deliver              → merge locally, no PR
          pr (--pr):        gate-pr → pending-review   → open a GitHub PR
```

Not every phase runs for every issue — the **workflow** (chosen from labels, confirmed at gate-plan) selects which phases are active. The **design** phase is optional: it always runs for the design workflow (and ends there), and runs for a feature/bugfix only when the planner asks for it (a `NEEDS-DESIGN` detour from the plan phase, confirmed at gate-design). The **manual** workflow is reached the same way — when the planner judges an issue has no code to build it returns `MANUAL`, and run carries the issue to done through a single confirmation gate (`gate-manual`) with no branch, tests, or PR.

**Rung — how heavy the phases run.** Orthogonal to the phase set, the **planner** returns a **rung** that sizes the ceremony to the task. The choice turns on two questions — *does the change add/alter behavior — and if not, does it touch any checkable surface at all?* — and there are four:
- **`STANDARD`** — new or changed behavior. The full path (TDD micro-loop per task, two-pass review); its proof is a **new test, red-verified**.
- **`EXPRESS`** — no new behavior, safe because *nothing live depends on the touched code* (dead-code removal, constant bump, isolated copy tweak). Proof: a **triviality grep**.
- **`REFACTOR`** — no new behavior, but the code *is* used and you're restructuring it (extract/inline, rename across call sites, dedup, move a module). Proof: **coverage** — the existing suite exercises the behavior and must stay green across the change.
- **`TRIVIAL`** — no new behavior **and no checkable surface**: the edit touches only whole inert files that feed no `$CHECKS` command (prose docs, `LICENSE`, `CHANGELOG`). The lightest path — collapsed front half, **no review, no validate, no e2e**, and the back-half trimmed to the checks a touched path actually feeds (usually none). Proof: an **inertness proof**, re-verified against the real post-edit diff. A comment/whitespace edit *inside* executable source is **not** `TRIVIAL` (the file feeds a check) — that's `EXPRESS`.

`EXPRESS` and `REFACTOR` share one [collapsed path](#the-collapsed-path) (collapse the test-authoring front half, keep the back half; single-pass review); `TRIVIAL` is lighter still (below). They differ in their proof. **No rung skips a check that can see the change** — the regression/fitness **back half runs at every rung with checkable surface** ([the back-half rule](#the-back-half-rule)), and `validate`/reachability runs for all but `TRIVIAL` (for the collapsed rungs it is the *primary* evidence; `TRIVIAL` has no symbol for a trace to reach). run never picks the rung itself — the planner does, from context, exactly as it decides `NEEDS-DESIGN`; a mis-called rung **auto-bumps up** the moment its proof fails (`TRIVIAL`→`EXPRESS` when a touched path turns out checkable, `EXPRESS`→`STANDARD` when its triviality proof fails) — a one-way ratchet. The confirmed rung is persisted (`rung:`), so it governs on resume.

**Context is sized on demand, not fixed.** The `context` agent self-calibrates retrieval depth to the issue and biases light; if the planner finds Zone 1 too thin it raises `NEEDS-CONTEXT`, and run deepens exactly that gap (bounded). run does not assess how much context an issue needs any more than it assesses complexity — the specialists signal, run reacts.

**Resume.** On every invocation, run **Startup** first. Startup either starts fresh from the workflow's entry phase, or — if a state file exists — jumps directly to the recorded phase and continues. **Never re-run a completed phase — or a completed step within one — on resume.** When jumping, go straight to that phase's section and to the step after the one `phase_step` / `task_index` records as done.

**Re-running a reasoning agent is not a retry.** It shares no memory with the first call and returns a *different* result — a second pass-1 review yields a different finding set, which then has to be reconciled against the first by a merge rule this skill does not define. So an unnecessary re-run does not merely cost tokens; it puts an ad-hoc union of two opinions in front of a gate that decides what ships. Treat a re-run as a defect to avoid, not a safe default.

**When the recorded position is ambiguous, read the last Zone 2 entry — not the whole file.** A crash can land between an agent returning and run persisting that fact, so a `phase_step` of `-` inside a multi-pass phase means *either* "the step hasn't run" *or* "it ran and the write was lost". Resolve it with one bounded read: `tail` `context.md` for the **last** `### [ts] · author · ref` header. Appending agents write their entry *before* they return, so that entry is a receipt the agent produced itself — strictly more durable than run's own bookkeeping, and the reason the [append-only rule](#contextmd-zone-2--the-shared-timeline) is mechanically enforced rather than merely stated: if entries could land mid-file, the last one would not be the latest and this read would lie.

| Last Zone 2 entry | Verdict |
|---|---|
| author = this step's agent, in this step's mode, timestamp **≥** the phase's start line in `## Log` | the step ran — record it done, rebuild any gate panel from that entry, continue to the next step |
| anything else (older, different author, none) | the step did not run — invoke it |

Never widen this into a scan of Zone 2 or a reconstruction from `git log`, `plan.md`, and the diff. The check fails **toward re-running**, never toward skipping: an unnecessary re-run is expensive, but a skipped review phase ships unreviewed code and nothing downstream notices.

**Agents communicate only through artifacts.** Agents are stateless specialists. They share nothing in memory — only files (durable) and their final return message (the immediate decision payload run parses). run is the sole writer of `state/issue-N.md`, and the writer of `.lock` for a run (the short-lived `pr-fix` skill also takes `.lock`, tagged `holder: pr-fix`). The durable cross-agent channel for decisions is `context.md` Zone 2 — an append-only timeline (see [Reference](#contextmd-zone-2--the-shared-timeline)).

**Human gates are declared up front.** At gate-plan the user sees every gate that will fire for this issue. Gates beyond gate-plan only appear if the execution plan includes them. In **auto** mode the gates don't stop — run decides and logs at each one instead. See [Autonomy](#autonomy-and-delivery).

**Gates are resumable.** A gate panel is built from an agent's return message, which is not durable. So **before presenting any gate, write the structured payload that builds it to the state file's `## Pending gate` block** (the findings table, the critique scorecard, the validation results, the PR body). If a session resumes *at* a gate, rebuild the panel from that block — never re-run the agent to reconstruct it. Clear the block once the gate is resolved.

**The green-check gate is "no *new* test failures," not "zero failures."** Accepted known-failing tests (in `.context/devloop-baseline.md`) do not block. See [Known-failing baseline](#known-failing-baseline).

---

## Autonomy and delivery

run has **two orthogonal axes**, each chosen per invocation and fixed for the life of the run.

**Autonomy — who decides at gates.**
- **human** (default) — every gate **stops and waits** for a person to approve, shape, or verify. This is the mode every gate section below describes.
- **auto** (`run --auto`) — human-*on*-the-loop. The same phase spine, agents, resume logic, and Zone 2 discipline run unchanged, but **gates don't stop**: at each gate run applies a decision rule, acts, and logs the decision *and its reasoning* to `context.md` Zone 2. An auto run **runs to completion — it merges** — rather than halting for review; the human audits the shipped work afterward in the outer loop (`/devloop:review`) and spawns rework issues for anything that needs changing. Invoking `--auto` is the user's authorization to take every within-scope action, **including the merge**, without a per-step prompt.

**Delivery — how the branch lands.**
- **direct** (default) — merge the branch into the base **locally** (rebase-if-behind, then merge, push, delete the branch); **no GitHub PR**. A solo dev rarely needs a PR review, and the real review is the outer loop. `Closes #[ISSUE]` in the merge commit auto-closes the issue.
- **pr** (`--pr`) — open a **GitHub PR** as the delivery vehicle (for a PR-gated CI check, an audit trail, or a collaborator). In **human** mode the run **halts at the open PR** for review (`pr-review` / `pr-fix`, then re-run to merge); in **auto** mode it creates the PR and **merges it through** (required checks / branch protection gate the merge if configured).

The two axes give four behaviors:

| | **direct** (default) | **`--pr`** |
|---|---|---|
| **human** (default) | gates stop; `gate-deliver` → merge locally | gates stop; create PR, **halt** at `pending-review` → re-run to merge |
| **auto** (`--auto`) | run to completion → merge locally | create PR → merge through |

Only the **human + pr** cell halts for review before merge; every other cell merges within the run. `/devloop:sprint` drives plain `run --auto` (direct) across the whole sprint.

**Set at invocation, never inferred.** `$AUTONOMY` is `auto` when `--auto` is in `$ARGUMENTS`, else `human`; `$DELIVERY` is `pr` when `--pr` is present, else `direct`. Persist both as `autonomy:` and `delivery:` in the state file (S6). On resume the state file governs — a run keeps the character it started with and never silently switches; flags on a resume that differ from the recorded modes do not switch them (warn if they differ). **One exception, in one direction: autonomy may be downgraded `auto` → `human`** on a resume invoked without `--auto`. That is the exit from every auto-mode blocker: what stopped the run was something only a human can resolve, so a resume that could not take the human's seat would re-hit the same wall forever (see [Failure modes](#failure-modes)). A downgrade only *adds* oversight, so it needs no extra authorization; the upgrade `human` → `auto` is the dangerous direction and is never taken on resume — `--auto` on a run recorded `human` warns and stays `human`, because a run's authorization to merge without asking is granted at its start, not retrofitted onto work already half-done. Record the downgrade in the state file (`autonomy: human`) and in a `## Log` line. `$DELIVERY` never switches on resume in either direction. (The `## Pending gate` block is a human-mode device for re-presenting a panel; auto-mode resolves gates in place and does not rely on it — so a downgraded resume rebuilds its gate panel from the artifacts, as a fresh human-mode run would.)

**Decision policy (auto-mode).** At each gate, take the choice the human-mode panel would *recommend* — the agents' own verdict — and record why:
- accept the agent's structured output as produced (the planner's plan, **rung**, and phase set, a `sound` design, the reviewer's upheld findings). **Accept the planner's rung; never downgrade it on run's own initiative** — the planner chose the rung from context, and auto-mode has no human to catch an over-eager downgrade. A rung only ever moves *up*: the `TRIVIAL`→`EXPRESS` bump (a touched path turns out checkable) and the `EXPRESS`→`STANDARD` bump (triviality proof fails, or an EXPRESS blocker/`new` failure surfaces) are automatic and **not** a stop — each converts to fuller ceremony and continues.
- **context on demand is mechanical, not a stop.** A planner `NEEDS-CONTEXT` re-invokes `context` in `deepen` mode with no human needed; after the 2-deepen cap, re-invoke the planner with `$CONTEXT_FINAL: true`. Only if it *then* escalates to `NEEDS-DESIGN` (or genuinely cannot plan) does the normal boundary apply.
- **prefer proof over guessing.** Where a load-bearing choice can be settled empirically, **run a spike** (throwaway `coder` PoC) rather than reasoning to an answer — auto-mode has no human to sanity-check a guess, so evidence is cheaper than a wrong assumption caught later. In the design phase this means running *every* `NEEDS-PROOF` spike the designer raises **and** any spike the critique still recommends before approving; more broadly, when a decision hinges on an untested assumption a spike could verify, spike it and fold the finding in rather than proceeding on reasoning alone. Log the spike and its finding.
- when a rule is ambiguous, take the safe, reversible option and log the alternative not taken;
- resolve the gate with the same Zone 2 entry human-mode writes — attributed to `run (auto)` with its reasoning, not to the user.
- For any *inline* y/n prompt outside a gate, likewise take the safe option and log it: **do not** mutate shared project records (`devloop-profile.md`, `devloop-baseline.md`) or create/close GitHub issues on a guess, and where a step needs input run can't supply (e.g. a missing profile command), proceed with that input **absent for this run** and log it — never block on a convenience prompt.

**The boundary — what auto-mode will not fake.** Auto-mode never fabricates a judgment it structurally cannot make. At these points it **stops, logs a blocker** (Zone 2 + `## Log`), releases the lock, and exits — leaving the issue in-progress so a later `run` resumes from the recorded phase:
- coder stuck after 3 attempts on a task;
- `new` (non-baselined) test failures it cannot fix;
- a test that cannot be made to fail meaningfully after two bounces off the `red` check (a build-loop test or a blocker's regression test) — a test nobody has ever seen fail is not evidence, and auto-mode must not manufacture a confidence a human would have withheld;
- a clean test still unreachable after two `narrow-interface` widenings — at that point the interface isn't the problem, the design is;
- a design critique still `needs-work` after one iteration;
- an AC with **no production call path** that one scoped wiring task could not close (see [validate](#reachability-a-green-test-is-not-a-satisfied-ac)) — wiring it would mean picking an entry point or a design intent the run isn't entitled to choose;
- a rebase/merge conflict, or an agent returns `ERROR:`;
- a **manual-workflow** issue (`gate-manual`) — the work is outside the repo; no reasoning substitutes for it.

A manual *acceptance criterion* (at gate-validation) is **not** a hard stop: auto-mode tries to automate it, and if it can't, flags it in the PR for the human to verify (see gate-validation). An **unreachable** AC is a different animal and *is* a stop if it can't be wired: the flag says "a human must check this", while the empty trace says "this does not work" — carrying the latter forward as a flag is how it merges with a tick beside it.

---

## Reference — artifacts

| Path | Scope | Writer | Purpose |
|---|---|---|---|
| `.context/sprints/work/issue-N/context.md` | issue | `context` (Zone 1); `designer`/`planner`/`test-writer`/`coder`/`reviewer` + run append Zone 2 | retrieved facts + decision timeline |
| `.context/sprints/work/issue-N/design.md` | issue | `designer` | implementation guide / decision doc (when a design phase ran) |
| `.context/sprints/work/issue-N/plan.md` | issue | `planner` | `Rung:` (EXPRESS/STANDARD/REFACTOR) + ordered tasks + acceptance per task; EXPRESS carries a `Triviality proof` section, REFACTOR a `Coverage` section |
| `.context/sprints/work/issue-N/test-plan.md` | issue | `planner` (critiqued by `test-critic`) | the purpose reading, then per task each behavior's **proof** — `test` (happy/edge/error scenarios), `observe` (a check a person runs), or `none` — plus e2e flows. Format and reasoning: `skills/run/test-strategy-spec.md` (STANDARD only; EXPRESS/REFACTOR write none — see the planner's `Triviality proof` / `Coverage` section instead) |
| `.context/sprints/work/issue-N/spike/` | issue | `coder` (spike mode) | throwaway proof-of-concept; reference only, safe to delete |
| `.context/sprints/work/issue-N/logs/` | issue | `coder`, `test-runner` | raw test/check output — the evidence behind a Zone 2 entry. Never loaded by default; cited under **Artifacts** and opened on demand |
| `.context/sprints/work/issue-N/run-state-final.md` | issue | **run** (at cleanup) | the archived state file — its `## Log`, plan, and tasks kept for post-mortem after the issue is done |
| `.context/sprints/state/issue-N.md` | issue | **run only** | phase, position, branch, pr, plan, tasks, log — **while in progress**; archived to `work/` at cleanup |
| `.context/sprints/state/.lock` | global | **run** + `pr-fix` + `tinker` + `vibe` | `holder` (`run`/`pr-fix`/`tinker`/`vibe`), issue or PR number, PID, start time |
| `.context/devloop-profile.md` | project | roadmap; **run write-back** | build/test commands + test layout |
| `.context/devloop-baseline.md` | project | **run** (on user decision) | accepted-failing tests |
| `.context/devloop-journal.md` | project | **run**, `tinker`, `vibe`, `review`, `architect`, `abort` | one line per finished episode of work — the retrieval surface the `context` agent scans (see [The project journal](#the-project-journal--one-line-per-episode)) |
| `.context/devloop-unproven.md` | project | `tinker` | behaviour shipped without a test, by explicit decision — read by `review` at sprint close and by `plan` when scoping |

`work/` and `state/` are run's working area for one issue; `profile`, `baseline`, `master-plan`, and `sprint-N` are shared project records. Whether any of these are version-controlled is the user's choice — run neither assumes nor enforces a gitignore policy.

### context.md Zone 2 — the shared timeline

Zone 2 is an **append-only timeline**: agents and gates add entries in execution order; nobody edits or deletes a prior entry. It carries decisions — not just artifacts — between phases. Each entry stands alone (a later reader understands it without re-deriving) and every entry opens with the same header:

```
### [<$NOW>] · <author> · <ref>
```

`###`, brackets around the timestamp, ` · ` separators — then `Did` / `Decisions` / `Caught by` / `For next` / `Artifacts`. **Never `##`.** A `##` opens a new top-level section, so the file gains a second "Zone 2" and everything appended after it nests under the wrong one; the entry also loses its author, which is what [resume](#how-this-skill-works) matches on and what `Caught by:` provenance hangs off. The observed corruption is the section header `## Zone 2 — Agent notes` copied with the timestamp substituted for "Agent notes" — an imitation of the nearest visible heading, which is why the format is restated at every write site rather than pointed at from here.

**Append with a shell append (`cat >> …/context.md <<'EOF'`) — never `Edit`.** This is the mechanism, not a style preference. "Append-only" as prose forbids *editing a prior entry*; it does not stop a targeted `Edit` from landing its new entry wherever its anchor happened to match — which in a 100 KB file is routinely next to similar-looking prose, including inside Zone 1. `>>` physically cannot write anywhere but the end. Everything downstream depends on this: `run` resumes from the **last** entry (see [Resume](#how-this-skill-works)), and an inserted entry makes the last one stale — so the read that is supposed to prevent a duplicate agent call would instead skip one that never ran. The file must end with your entry; if you cannot append, say so rather than editing one in.

Agents are not limited to the standard files — a step may create its own supplementary artifact (a generated schema, a scratch analysis, a data sample). When it does, it lists the path under **Artifacts** with a one-line "load this if…" hint, so a later agent (or run) chooses whether to read it instead of everyone loading everything.

### The project journal — one line per episode

`context.md` Zone 2 is a *per-issue* record, and nothing outside `/devloop:review` ever reads it
again. `.context/devloop-journal.md` is the project-level surface that does get read: the `context`
agent scans it on **every** issue and pulls the entries whose code areas intersect the work at hand,
into Zone 1 under **What happened here before**. It is how issue #52 finds out that a value in the
file it is about to edit was tuned by hand while a human watched the app — and therefore is not a
mistake to clean up.

The format is `skills/tinker/journal-spec.md`. run writes a line at exactly two moments:

| Moment | Outcome |
|---|---|
| the issue completes ([Issue-complete cleanup](#issue-complete-cleanup), step 4) | `shipped` |
| an auto-mode **stop-the-line** halts the run | `blocked` |

```
- YYYY-MM-DD · run #[ISSUE] · shipped · `src/auth/**` · [what it did, and why anything non-obvious is that way] → `sprints/work/issue-[ISSUE]/`
```

**Restated here because this is the write site:** append with `cat >> .context/devloop-journal.md`,
**never `Edit`** (an `Edit` lands wherever its anchor matched — in a file of near-identical lines that
is routinely the wrong one; `>>` cannot). The date is **script-derived**
(`node -e "console.log(new Date().toISOString().slice(0,10))"`). The **areas come from
`git diff --name-only $base...<branch tip>` collapsed to directory globs — derived mechanically, never
composed**: a fluent, plausible, wrong area poisons retrieval for every future issue and fails
silently, exactly the way a guessed MCP tool name fails. One line only; the detail already lives in
the work dir this line points at. Never rewrite an earlier line — a correction is a new line.

If the file does not exist, create it with the header from the spec and append. An absent file is not
a reason to skip the record.

### Detection provenance — `Caught by:` and the log trail

**Record how each defect was found, not just that it was fixed.** Any Zone 2 entry that records a defect carries a **`Caught by:`** field naming the gate that detected it: `test-red` · `typecheck` · `lint` · `reviewer` · `critique` · `validation` · `spike` · `demo` · `human`. (`demo` and `human` are written by `/devloop:review` in the outer loop, not by run — `demo` when running the change through the real entry point surfaces a defect every inner-loop gate passed.) Without it the history is unreconstructable — `/devloop:review` cannot tell a human whether a bug was caught by a failing test or by someone reading the code, and neither can you tell, across many issues, **which gates are actually load-bearing and which never fire**. That is the only way to find out that (say) the test suite has never once caught a real bug while the critique catches most of them.

**Evidence goes in a log file, not in Zone 2.** Zone 2 is loaded by every downstream agent — the planner, the coder, the reviewer all read `context.md`. Paste a stack trace into it and every future agent on this issue pays that context cost to serve one reader who shows up at the end. So split it:

| Tier | Where | Content |
|---|---|---|
| **Signal** | Zone 2 entry | failing test id, the one-line error, `Caught by:`, and the log path under **Artifacts** |
| **Evidence** | `work/issue-N/logs/<timestamp>-<what>.log` | the raw output — full failure, stack, assertion diff |

Pass `$LOG_DIR` = `$WORK_DIR/logs/` (absolute, per [S1](#s1--resolve-the-active-sprint)) to the `coder` and the `test-runner`; each writes its own output there and returns the path, which run (or the agent itself) cites under **Artifacts**. Nobody loads a log by default; `review` opens one on demand when the human says "show me the failure."

**Who appends:**
- `designer`, `planner`, `test-critic`, `test-writer`, `coder`, `reviewer` — one entry each when they finish (per their contracts).
- **run** — one entry at each gate decision (a human's in human-mode, run's own reasoned decision in **auto**-mode, attributed to `run (auto)`) and whenever it changes shared state: a plan reshaped/accepted at gate-plan, findings accepted/declined at gate-review, manual ACs confirmed or flagged at gate-validation, a failure baselined, or an auto-mode blocker that halts the run. At gate-review run sets **`Caught by:`** per finding — `reviewer` for pass 1, `critique` for a finding pass 1 missed.

  **An auto-mode stop-the-line writes a journal line too**, alongside its Zone 2 entry, with outcome `blocked` — *"tried, stopped deliberately, state on disk"* is the single most expensive fact in a project to rediscover, and it costs one line here. Same rules as everywhere: `cat >>`, never `Edit`; script-derived date; areas from `git diff --name-only`, mechanically. Do this before exiting, not after — there is no after.
- `context` owns Zone 1 and writes **one seed entry** in Zone 2 recording the depth tier it chose — the first entry in the timeline, and the correctly formatted example every later appender sees at the write site. `test-runner` **never writes to Zone 2** — it returns its buckets (and its log path) to run, which records any baselining and cites the log. Writing its own run log to `$LOG_DIR` is not an exception to that: it is capturing evidence, not mutating state, and its `disallowedTools` still bar it from touching code or tests.

**Timestamps must be script-derived — never the session clock.** Before invoking an appending agent, and before writing your own gate entry, derive a fresh timestamp and use it as `$NOW`:

```
node -e "console.log(new Date().toISOString())"
```

Node is always available (the bundled milestone MCP requires it); the trailing `Z` is the timezone designator. Pass `$NOW` into the agent invocation — the agent uses it verbatim. **Never** use a date from the prompt or session context; it may be stale.

**One derivation per invocation — never reuse a `$NOW` across two agent calls**, however close together. Timestamps are what make the timeline *ordered*, and the ordering is load-bearing: resume compares the last entry's timestamp against the phase's start line, and the retro reads elapsed time per phase. A batch of entries sharing one stamp carries no order at all, and an out-of-place entry among them is undetectable. Reuse it verbatim inside a single agent's own entry and log filenames, and nowhere else — including the `$LOG_DIR` filenames, which must render the same instant the same way every time.

### State file schema

```markdown
# Issue N — run state

issue: N
workflow: feature | bugfix | design | scaffold | manual
rung: trivial | express | standard | refactor | -   # set at gate-plan from the planner's plan.md; '-' until then / for non-code workflows
autonomy: human | auto           # set at S6 from $AUTONOMY; rewritten to 'human' on a downgraded resume (S6) — never to 'auto'
delivery: direct | pr            # set at S6 from $DELIVERY; never rewritten
                                 # both govern on resume — a resume flag cannot switch them, downgrade excepted
phase: <phase name>
phase_step: -        # multi-pass phases (design/plan/review/validate): the last step COMPLETED, written after
                     #   that step's agent returns; '-' = nothing completed yet / not a multi-pass phase
task_index: -        # build-loop position, 0-based: the next task to run, incremented after one completes; '-' otherwise
branch: <branch>     # '-' until created
base: <base branch>
pr: -                # set once PR created
merge-commit: -      # the squash/merge SHA on $base; set at merge
history-ref: -       # refs/devloop/issue-N — the branch as built, archived at merge (local only)

## Plan (confirmed at gate-plan)
rung:   trivial | express | standard | refactor   # STANDARD: full TDD; EXPRESS/REFACTOR: collapsed front half, back-half kept; TRIVIAL: inert edit, no review/validate, subset back-half
phases: context, [design,] plan, build, e2e, review, validate, <gate-deliver | gate-pr>, merge
gates:  gate-plan ✓, gate-review, gate-validation, <gate-deliver | gate-pr>

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

Append a `## Log` line at every phase boundary and human decision.

**`phase:` is written on entry; `phase_step:` and `task_index:` are written on completion.** They answer different questions and a crash must read them differently:

- **`phase:`** is set *before* the phase runs, so a crash resumes into the right phase instead of redoing the previous one.
- **`phase_step:` / `task_index:`** name **what is finished** — every step value is past-tense (`drafted`, `reviewed`, `critiqued`, `auto-checked`, `gated`) — so each is written *immediately after* the agent returns: the **first** thing you do with a return, before parsing it, reasoning about it, or presenting anything. Write it together with the `## Pending gate` payload in the same edit when a gate follows.

Writing a step marker *before* invoking makes "about to run the reviewer" and "the reviewer finished" the identical value on disk, and a resume then re-runs the most expensive agent in the loop. (The build loop already records position this way — `task_index` increments *after* the task is marked `[x]`.)

---

## Startup

Run this section on every invocation, in order.

### S1 — Resolve the active sprint

Capture `$REPO_ROOT` = `pwd` — the directory `.context/` lives in for this invocation. Every path passed to an agent this run (`$WORK_DIR`, `$LOG_DIR`, and anything under them) is built as `$REPO_ROOT/...` and handed over **absolute**, never a bare `.context/...` string. This matters specifically because `coder` and `test-runner` run `$CHECKS`/`$UNIT_CMD`/`$E2E_CMD` via Bash, and in a monorepo those commands often `cd` into a subpackage (e.g. `cd apps/web && npm test`) — that `cd` persists for the rest of their Bash session, so a relative log path resolved *after* the check runs lands under the subpackage instead of `.context/`. An absolute `$WORK_DIR`/`$LOG_DIR` is immune to that drift.

Determine the active sprint:
- Read `.context/sprints/master-plan.md`; find the entry with `- **Status:** active`. Use its sprint number and `Sprint file:`.
- If none is active, fall back to the highest `.context/sprints/sprint-N.md` on disk.

If no sprint file can be found:

> No active sprint found — run `/devloop:plan` first.

Stop. Otherwise read the sprint file and extract `$SPRINT_N`, `$SPRINT_FILE`, `$SPRINT_GOAL`, `$SPRINT_DEMO` (the `**Demo:**` line — absent on an older sprint file, and then simply unset), `$REPO`, and the ordered issue checklist.

### S2 — Concurrency guard

Read `.context/sprints/state/.lock` if it exists. Determine PID liveness with `kill -0 <pid> 2>/dev/null` (exit 0 = alive).

| Lock | Action |
|---|---|
| live PID, `holder: run` | `⚙ run is already in progress for #M (PID alive). Finish or /devloop:abort it first.` → **exit**. (A live process owns the run regardless of `$ISSUE`.) |
| live PID, `holder: pr-fix` | `⚙ pr-fix is working the tree on PR #[pr] (PID alive). Let it finish before starting a run.` → **exit**. |
| live PID, `holder: tinker` | `⚙ a tinker session is working the tree (PID alive). Close it (/devloop:tinker → "done") before starting a run.` → **exit**. |
| live PID, `holder: vibe` | `⚙ vibe is building in this tree (PID alive). Let it reach its next demo point first.` → **exit**. |
| dead PID | **Read the file's fields before deleting it** — `holder` (missing predates the field; treat as `run`) and, on a `run` lock, `issue:` captured as **`$LOCK_ISSUE`**. Then `⚠ Found a stale lock from a previous run on #[issue] — clearing it.` → delete `.lock`, proceed. |
| absent | proceed |

**Capture `issue:` before the delete, not after.** A stale lock is the only artifact that names the issue that was in flight, and S4 needs it to resolve a no-arg resume. Deleting the file first destroys that answer and leaves S4 reconstructing it — which is how a one-line lookup turns into a search. (`/devloop:abort` reads the same field for the same reason.)

### S3 — Read project profile and baseline

Read `.context/devloop-profile.md`. If it does not exist:

> `.context/devloop-profile.md` not found — run `/devloop:roadmap` to set up build/test commands first, or I'll have to ask for each command as I need it. Continue anyway? (y/n)

On **n**, exit. On **y**, proceed and ask for commands inline when a phase needs one (writing each answer back to the profile).

Collect the profile's **check commands** (`build`, `unit-test`, `typecheck`, `lint`, and `e2e-test` — whichever the profile lists) as **`$CHECKS`**: the checks run executes locally as the back-half, at **every rung**. run never hardcodes this set — it is exactly what the profile declares. A project whose CI owns a heavy check (a full e2e matrix, integration, a security scan) simply does not list it here; in `--pr` mode the merge is still gated on that CI by branch protection (see the [merge phase](#delivery-pr)), and `direct` mode has no CI, so the profile's checks are the whole gate.

Read `.context/devloop-baseline.md` if it exists (the accepted-failing allowlist). Treat absent as empty. Collect its test ids as **`$ACCEPTED`** — these are already-failing, already-accepted checks, and **every agent that runs the suite must be told about them**, not just the `test-runner`. A suite command exits non-zero on an accepted failure exactly as it does on a real one, so a `coder` that has not been given `$ACCEPTED` can never reach green in a project with a baseline: it would burn all three attempts chasing a failure that is not its own, on every task. Pass `$ACCEPTED` to the `coder` alongside `$CHECKS`.

### S4 — Resolve the target issue and entry point

Two questions, in order — **which issue**, then **where in it**. Both are answered by named files; neither is answered by searching.

**1. Resolve `$ISSUE`.** Take the first row that applies:

| Condition | `$ISSUE` |
|---|---|
| an issue number in `$ARGUMENTS` | that number (it wins over everything below — an explicit target is never overridden by a stale lock) |
| `$LOCK_ISSUE` was captured in [S2](#s2--concurrency-guard) | `$LOCK_ISSUE` |
| `ls .context/sprints/state/issue-*.md` → exactly one | that issue |
| `ls .context/sprints/state/issue-*.md` → more than one | list them; ask which to resume or abort |
| `ls .context/sprints/state/issue-*.md` → none | the first unchecked issue in `$SPRINT_FILE` |

**"In progress" means exactly one thing: a file matching `.context/sprints/state/issue-*.md`.** An empty `state/` is a *complete answer* — no run is in progress, start fresh — not a gap to go investigate. A finished issue's state file was moved to `work/issue-N/run-state-final.md` at [cleanup](#cleanup); that archive is for post-mortem reading by `/devloop:review` and is **never** consulted here.

**Startup never spawns a search agent.** Every fact it needs is at a path named in S1–S4 (`master-plan.md`, `.lock`, `state/issue-*.md`, `devloop-profile.md`, `$SPRINT_FILE`). If one of those is missing, that absence *is* the answer — take the row that says so. Fanning out a subagent to work out where to resume burns more context than the phase it is trying to avoid re-running.

**2. Resolve the entry point** from `$ISSUE`'s state file:

| State file `issue-N.md` | Action |
|---|---|
| exists | Check GitHub: if the issue is already closed (its PR merged, or a direct merge landed) → entry = **merge** (cleanup only). Else entry = the recorded `phase` (resume) — and within it, the position recorded in `phase_step` / `task_index`, per [Resume](#how-this-skill-works). |
| none | Entry = the workflow entry phase (fresh). Warn if `$ISSUE` is not in `$SPRINT_FILE`, but allow. |

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

A non-structural `type:chore` starts as **feature** here, but may turn out to have no code to build (configure DNS, obtain a sign-off, a manual QA pass). run does not decide this at startup — the **planner** does, returning `MANUAL` from the plan phase, which routes the issue to the **manual** workflow (a single confirmation gate, no branch/tests/PR). The user can also force it at gate-plan ("this is a manual task").

Some issues don't fit a single archetype — "run the suite and review existing code," a spike/investigation, a docs-only chore, or a task that mixes design and build. In those cases pick the nearest template and let the planner propose a **custom phase set** drawn from the named phases; the user shapes the final list at gate-plan. The archetype only decides where to *start*; the actual phases run executes are always the ones confirmed there. (On resume, the confirmed phase list in the state file governs — S5 does not re-run.)

### S6 — Acquire lock and dispatch

Write `.context/sprints/state/.lock` with `holder: run`, `issue: $ISSUE`, the current PID (`pid:`), and an ISO `start:` time. The `holder` field distinguishes this from a `pr-fix` lock (`holder: pr-fix`, `pr: N`) on the same file — every reader keys mutual exclusion off the PID, and uses `holder` only to label who holds the tree. If no state file exists yet, create `state/issue-N.md` with the schema above (`phase: context`, branch `-`, `autonomy: $AUTONOMY`, `delivery: $DELIVERY`). When **resuming** an existing state file, `$AUTONOMY` and `$DELIVERY` are read from its `autonomy:`/`delivery:` lines — the started modes govern; flags on a resume that differ from the recorded modes do not switch them (warn if they differ). **The one sanctioned switch is the autonomy downgrade** (see [Autonomy and delivery](#autonomy-and-delivery)): recorded `autonomy: auto` + no `--auto` in `$ARGUMENTS` → set `$AUTONOMY = human`, **rewrite the state file's `autonomy:` line to `human`**, and append a `## Log` line (`autonomy downgraded auto → human on resume`). Never the reverse: `--auto` on a state file recording `autonomy: human` warns and leaves it `human`. `$DELIVERY` is never switched by a resume flag in either direction — a `--pr` on a run recorded `direct` (or the absence of one on a run recorded `pr`) warns and changes nothing.

Announce and dispatch:

> **▶ run — Sprint [N] · #[ISSUE] [title] · workflow: [workflow] · mode: [human | auto] · delivery: [direct | pr]**
> [Starting fresh from context. | Resuming from phase "[phase]".]
> [downgraded resume only:] Autonomy downgraded auto → human — gates will stop for you from here.
> [auto only:] Human-on-the-loop — no gates will stop; every decision is logged to context.md for your review. I'll halt only if I hit something I can't decide safely.

Jump to the entry phase. The lock is released on clean exit, at `pending-review`, and at `merge`.

---

## Phase: context

**Active in:** all workflows.

If resuming and `context.md` already exists:

> Context for #[ISSUE] was built [relative time] ago ([build timestamp]). Refresh it from scratch? (y/n)

Compute the relative time from scripts, not the session clock: read the build timestamp recorded in the state log when context was last built, take the current time with `node -e "console.log(new Date().toISOString())"`, and derive the delta from those two values. If no build timestamp was recorded, show the absolute timestamp only.

On **n**, keep the existing file and continue. On **y** (or on a fresh start), invoke `context`.

Invoke **`context`**, passing: `$ISSUE`, `$REPO`, `$SPRINT_GOAL`, `$SPRINT_DEMO` (the planner reads both, verbatim, to decide how much testing the work deserves), `$WORK_DIR` = `$REPO_ROOT/.context/sprints/work/issue-N/` (absolute — see [S1](#s1--resolve-the-active-sprint)), a one-line profile summary, and `$NOW` (script-derived) for its Zone 2 seed entry. For **scaffold**, request the `light` variant (issue + workspace map only); otherwise `full`, in which the agent **self-calibrates depth** (`minimal`/`standard`/`deep`) to the issue and biases light — run does **not** dictate the depth, exactly as it does not assess complexity for a design decision. It writes `context.md` Zone 1 and returns the `TIER` it chose. Record the build time (`$NOW`) **and the tier** in the state log so a later resume can compute the relative age and the retro can see whether the default is calibrated.

**A light default is safe because context is reachable on demand.** If a later agent finds Zone 1 too thin, it raises `NEEDS-CONTEXT` (the planner does today; see [plan](#phase-plan)), and run re-invokes `context` in `deepen` mode to fill exactly that gap — appending to Zone 1, not rebuilding. This is the escape hatch; it is what lets the agent bias light without starving the planner.

Record the next phase and continue: **design** workflow → `phase: design`; **feature/bugfix** → `phase: plan`; **scaffold** → jump straight to the **scaffold** section.

---

## Phase: design

**Active in:** the **design** workflow (always); **feature**/**bugfix** when the planner raised `NEEDS-DESIGN` from the plan phase. Produces an implementation guide / decision doc (`design.md`) before any task breakdown or code. Multi-pass — `phase_step`: `drafted → [spiked] → critiqued → gated`. *(Human gate: gate-design.)*

**Who decided design is needed:** for the design workflow, the **labels** did (S5 routing). For feature/bugfix, the **planner** did, via `NEEDS-DESIGN` from the plan phase — run never assesses complexity itself. **All design work is delegated to the `designer` agent**; it writes `design.md`, and run holds only the agents' return summaries (recommendation, coverage, criteria, concerns) plus the file path — never the design content — so run's context stays lean.

1. **Draft** (`phase_step: drafted`). Invoke **`designer`** (`mode: design`), passing `context.md`, the issue's acceptance criteria / open questions, and `$NOW`. It writes `design.md` to the work dir against the design rubric, and its return lists any **`NEEDS-PROOF`** assumptions — load-bearing claims that reasoning can't settle. run reads only the summary, not the full document.

   **ADR conflict.** The designer instead returns `CONFLICT: ADR-NNN — [why]` (no design written) when the issue cannot be satisfied within an accepted architecture decision (`.context/decisions/`). Overriding a recorded decision is a **supersession** — owned by `/devloop:architect`, never by run or its agents. Human mode: present the conflict and the choices — re-scope the direction (re-invoke `designer` with the guidance), take it to `/devloop:architect` first (supersede the ADR, then resume this run from the design phase), or abort. Auto-mode: **stop-the-line** — append a Zone 2 entry recording the conflict and exit; this is a decision the run is not entitled to make.

2. **Spike** (`phase_step: spiked`, optional). If the draft returned `NEEDS-PROOF` assumptions, present them and offer to validate before going further:

   > The design rests on [n] assumption(s) that need evidence, not reasoning:
   > - [assumption] — would spike: [what to measure]
   >
   > Run a spike to prove these? (all / select / skip)

   For each chosen assumption, invoke **`coder`** (`mode: spike`, pass the `$QUESTION` and `$NOW`). The coder writes throwaway code under `work/issue-N/spike/`, runs it, and returns an evidence-backed `FINDING` — committing nothing. Collect the findings, then re-invoke **`designer`** (`mode: design`, pass `$SPIKE_FINDINGS`) to fold the evidence in and resolve those assumptions. Skip this step entirely when there are no `NEEDS-PROOF` assumptions, or the user declines.

3. **Critique** (`phase_step: critiqued`). Invoke **`designer`** again as a **fresh instance** (`mode: critique`), passing the `design.md` path and `$NOW`. No shared memory → an independent second opinion. It scores the design against the **named criteria** — requirement-coverage, soundness, interface-clarity, interface-completeness, alternatives, simplicity, testability, consistency — returning a `pass`/`concern` per criterion, any spike still recommended, and a `sound`/`needs-work` verdict. run collects the scorecard; it does not reason about the design itself.

Record `phase: gate-design`. Continue.

---

## Gate: gate-design

**Active in:** design (always); feature/bugfix when a design phase ran. *(Human gate.)* `phase_step: gated`.

**Read `design.md` before presenting this gate** — this is the one gate where run loads the document rather than linking it, and the exception is deliberate. Everywhere else, run holds structured verdicts and lets the artifact stay on disk. Here the artifact *is* the decision: every later issue measures conformance against this document, and what it fails to say is never checked by anything again (a diff always conforms to a silence). A criteria table plus a link asks the human to approve a document they have not read, and the honest answer to that is `y`. The cost is one file in context, once, at the gate whose approval cannot be revisited.

Then present it as **three beats, one message each**, waiting for a reply between them — the same three rules as [gate-plan](#gate-gate-plan): each beat ends in a question the human can settle from what they just read, "not sure" is free and expands the beat, and it is said in the project's words (never *rung*, *phase_step*, *interface-completeness*). Never name a file, symbol or interface that isn't in `design.md`.

**Beat 1 · What it decides.** The approach in two or three sentences, and the shape it puts into the codebase — ASCII, `← new`, wherever it introduces or moves a boundary. Not the alternatives it rejected; those come up only if the human asks. → *Is that the right approach for what you want here?*

**Beat 2 · What it commits us to.** The interfaces and boundaries — the **binding** half of the document (code blocks are sketches and are not presented as decisions). Name **both sides** of any boundary it declares. → *Does this interface let the next caller do the wrong thing?* — the question the human is better placed to answer than any agent here, and the one nothing downstream re-asks.

**Beat 3 · What it doesn't cover, and what the critique found.** Lead with the gaps: requirement coverage, open `concern` rows, any assumption still resting on reasoning rather than a spike. Then the panel below and the decision. A silence surfaced here costs a sentence; discovered after the build, it is the shape of everything built on top of it.

> **Design — #[ISSUE]: [title]**
>
> [2–3 line summary of the approach + recommendation, from the designer's return]
>
> Requirement coverage: [k]/[total] addressed [list any gaps]
> Spikes run: [assumption → finding]   ← omit if none
>
> Critique (verdict: [sound | needs-work]):

| criterion | verdict |
|---|---|
| requirement-coverage | pass/concern — [issue] |
| soundness | … |
| interface-clarity | … |
| interface-completeness | … |
| alternatives | … |
| simplicity | … |
| testability | … |
| consistency | … |

> Full design: `.context/sprints/work/issue-N/design.md`
>
> Approve the design, request changes, run another spike, or skip design and plan directly:

- **Approve** → append a Zone 2 entry (`$NOW`) recording the approved approach and key interfaces (so the planner, coder, and reviewer build to it).
  - **design workflow:** offer to create the proposed follow-up story issues (with `type:feature`/labels), then complete the issue — no branch, no PR — via [Issue-complete cleanup](#issue-complete-cleanup) (no-PR variant), with the ✅ report `✅ #[ISSUE] — design recorded[; [k] follow-up issue(s) created]`.
  - **feature/bugfix:** record `phase: plan` and continue — the planner will now plan against the approved `design.md`.
- **Request changes** → re-invoke `designer` (`mode: design`) with the feedback, re-critique, re-present.
- **Run another spike** → the user (or an open `concern` on the testability criterion) can request a spike on a specific question; run the spike loop (step 2 above), fold the finding in, re-critique, re-present.
- **Skip design** (feature/bugfix only) → discard the guide, record `phase: plan`, and continue without it. On this path run re-invokes the planner with `$DESIGN_DECLINED: true` so it plans best-effort and does **not** bounce with `NEEDS-DESIGN` again (the user overrode the recommendation).

**Auto-mode.** No panel, and it favors proof over guessing (see [Autonomy](#autonomy-and-delivery)):
- In the design phase's spike step, run **all** `NEEDS-PROOF` spikes (the `all` option) before critiquing — never approve a design resting on an assumption a spike could test.
- After the critique, if it **still recommends a spike**, run that spike (step 2 of the design phase: spike → fold the finding in → re-critique) *before* deciding — even when the verdict is otherwise `sound`. Don't approve on reasoning while a recommended spike is outstanding.
- Then act on the verdict: **`sound`** (and no spike outstanding) → take the **Approve** path (Zone 2 entry; design workflow creates the proposed follow-up issues and completes via Issue-complete cleanup; feature/bugfix records `phase: plan`). **`needs-work`** → re-invoke `designer` **once** with the open concerns as feedback and re-critique; if it returns `sound`, approve; if still `needs-work`, **stop-the-line** (log the blocker and exit).
- Never take **Skip design** automatically — that would override the planner's own `NEEDS-DESIGN` call.
- **Mark the approval as unread.** Whenever auto-mode approves a design, its Zone 2 entry opens with **`AUTO-APPROVED — NO HUMAN REVIEW`** on its own line, naming the critique verdict it rested on and any concern it accepted. This is not a hedge about auto-mode generally — a code diff merged in auto is still there to be read afterwards, and the outer loop reads it. **A design's *silence* is not**: every downstream issue measures conformance against this document, so whatever it fails to say is never checked again by anything. A half a design leaves unstated becomes a half the build invents, and every later diff still matches the design exactly — conformance cannot see a silence. The marker is how `/devloop:review` knows which binding documents nobody ever read. Record it in **Zone 2 only** — never as an annotation on the sprint file, whose lines carry markers other skills own.

---

## Phase: plan

**Active in:** feature, bugfix. Multi-pass at `STANDARD` — `phase_step`: `planned → test-critiqued → [revised]`.

Invoke **`planner`**, passing `context.md`, the issue's acceptance criteria and Definition of Done, the profile flags (`$HAS_UNIT_TESTS`, `$HAS_E2E`), `$NOW`, and the `design.md` path **if a design phase ran**. It writes `plan.md` (ordered tasks + per-task acceptance, headed by a **`Rung:`** — `EXPRESS`, `STANDARD`, or `REFACTOR`) and, for `STANDARD`, `test-plan.md` (a purpose reading, then each behavior's proof — `test` scenarios, an `observe` check, or `none` — and e2e flows; bugfix is root-cause first). The collapsed rungs write no test-plan; each writes the one artifact that licenses it instead — a `## Triviality proof` section for `EXPRESS`, a `## Coverage` section for `REFACTOR`. If a design guide was provided, the tasks realise that approved approach.

**Context detour.** Zone 1 is sized light by the `context` agent. If the planner finds it too thin to plan responsibly, it returns `NEEDS-CONTEXT: [the specific fact it needs]` instead of a plan. run reacts by re-invoking **`context`** in `deepen` mode (`$MODE: deepen`, `$GAP:` the requested fact, `$NOW`) — which appends the fact to Zone 1 — then re-invokes the planner. **Capped at 2 deepens** (see [Bounds](#bounds--every-loop-in-this-cycle-is-capped)): if the planner still can't plan after two, the *issue* is underspecified, not the context — re-invoke it one last time with `$CONTEXT_FINAL: true` so it plans best-effort and records the residual uncertainty (human mode surfaces that at gate-plan; auto-mode proceeds and logs it, or stops-the-line if it instead escalates to `NEEDS-DESIGN`). A `deepen` that returns `unresolved` (the fact doesn't exist) counts against the cap and is itself signal — the planner may be assuming something absent.

**Design detour.** The decision to design is the **planner's**, not run's: if it judges it cannot responsibly break the work into tasks without an architecture/approach decision first, it returns `NEEDS-DESIGN: [why]` instead of a plan. run does not assess this itself — it simply reacts to the signal: activate the **design** phase above (draft → [spike] → critique → gate-design), and after approval return here and re-invoke the planner with the approved `design.md`. If the user declines at gate-design ("skip design"), run re-invokes with `$DESIGN_DECLINED: true` — the planner then plans best-effort and must not return `NEEDS-DESIGN` again (no loop).

**Manual detour.** Likewise the planner decides an issue has no code to build: it returns `MANUAL: [why]` instead of a plan. run reacts by switching the workflow to **manual** (`workflow: manual` in the state file), recording `phase: gate-manual`, and jumping there — it does **not** write a plan, create a branch, or run any build/test/review/PR phase. (This bypasses gate-plan entirely; the only gate for a manual issue is gate-manual.) Continue to [gate-manual](#gate-gate-manual).

**Test critique** (`STANDARD` only). The planner wrote the test plan and judged it sufficient — nobody else has read it, and everything after this builds, red-verifies and trusts exactly what it says. A missing edge here is never added later (the `test-writer` covers only what the plan lists); a filler test here is written, reviewed and kept forever. So, once `planner` returns `PLAN:` at `STANDARD` (write `phase_step: planned`):

1. Derive a fresh `$NOW` and invoke **`test-critic`** — a **fresh instance** — with `$WORK_DIR`, `$SPEC` = the absolute path of `skills/run/test-strategy-spec.md`, `$TEST_GLOBS` from the profile, and `$NOW`. It judges the plan in **both** directions: behaviors missing edge, error or permission cases, and scenarios that are filler, restate a value, re-check a library, or test what a person's eyes prove better — and whether the purpose reading behind each decision matches the evidence. Write `phase_step: test-critiqued` and the findings into `## Pending gate` the moment it returns.
2. **`VERDICT: sound`** → continue. **`VERDICT: revise`** → re-invoke **`planner`** with `$TEST_CRITIQUE` = the findings and a fresh `$NOW`; it revises `test-plan.md` in place and returns any `DECLINED:` finding with its reason. Write `phase_step: revised`.
3. **No second critique.** One pass, one revision: a critique of the revision would find something new in the new text, and the loop would never converge. What the critic changed and what the planner declined go in front of the human at gate-plan beat 3 — that is the check on the revision.

**Whenever the planner writes a new `test-plan.md` later** — a rung changed to `STANDARD` at gate-plan, an `EXPRESS`→`STANDARD` auto-bump in build — run this critique again before the plan is used. It is a new plan, and nothing has read it.

Auto-mode runs the same steps, with no stop: the critic's findings are applied by the planner, and the Zone 2 entries record both.

Record `phase: gate-plan`. Continue.

---

## Gate: gate-plan

**Active in:** feature, bugfix. *(Human gate.)*

### Build the execution plan

run owns the phase list. Start from the workflow default (the table in [How this skill works](#how-this-skill-works)), then adjust to the planner's **rung** (`plan.md`'s `Rung:` line) and what it produced:

- **`STANDARD`** — the full path: `build` (TDD loop per task) → e2e → review → validate → deliver.
- **`EXPRESS`** / **`REFACTOR`** — the [collapsed path](#the-collapsed-path): the `build` phase applies the change **without** the test-writer/red front half, running the rung's proof first (**triviality** grep for EXPRESS, **coverage** confirmation for REFACTOR) and the back-half suite; `review` is a **single reviewer pass** (no fresh-instance critique); `validate`/reachability still runs. e2e is dropped unless the profile+plan call for it.
- **`TRIVIAL`** — the lightest [collapsed path](#the-collapsed-path): the `build` phase applies the inert edit and verifies inertness on the diff (only the checks a target feeds — usually none); **no review, no validate, no e2e**. The only gates are `gate-plan` (now) and the delivery gate. The ACs are prose outcomes the human confirms from the diff at the delivery gate.

Then adjust for what the planner produced:
- `test-plan.md` has e2e flows marked `Proof: test` **and** the profile has an `e2e-test` command → include **e2e**. (A flow marked `Proof: observe` does not activate the phase — its check goes to validate.) Otherwise drop it. (`TRIVIAL`/`EXPRESS`/`REFACTOR` write no `test-plan.md`; `TRIVIAL` never runs e2e.)
- DoD includes "Code reviewed" → include **review** (single-pass for `EXPRESS`/`REFACTOR`, two-pass for `STANDARD`; **never** for `TRIVIAL` — an inert edit has no executable surface for the code-review rubric). The issue has acceptance criteria → include **validate** (**except `TRIVIAL`**, whose ACs carry no symbol to trace — they are confirmed at the delivery gate).
- Count build tasks from `plan.md`.

When the issue doesn't match its archetype, compose the phase set directly from the named phases to fit the real work — e.g. a "test + review existing code" task is `build`-less (review + validate only); an investigation/spike is `context → plan → gate-plan` then done. The phase list can be any sensible subset/order of the named phases — that is what makes the workflow dynamic while keeping every phase predictable. (The design phase is not composed here — it sits *upstream* of this gate and is reached via the planner's `NEEDS-DESIGN` detour or the design workflow.)

Then compute which **gates** will fire: `gate-plan` (now), `gate-review` (if review is active), `gate-validation` (if any acceptance criterion is manual / not test-backed), and the **delivery gate** — `gate-deliver` if `delivery: direct`, `gate-pr` if `delivery: pr` (always, for code workflows).

### Two checks on the plan itself, before anything expensive runs

Both read files you already have open. Both are cheap, and both catch a defect that is enormously more expensive one phase later.

**1 · Every `STANDARD` task has a proof.** Cross-check `plan.md`'s task list against `test-plan.md`: each task must have at least one behavior with a `Proof:` line — `test` with at least one scenario, `observe` with a check, or `none` with a reason. The build phase runs once *per task*, so a task with no behavior at all has nothing to build against — seeded as a test it returns `GREEN` (vacuous) or `RED-SETUP`, bounces twice, and escalates on the smallest item in the plan. Catching it here costs one comparison.

A task with no proof is a **planning defect**, not a rung question — re-invoke the `planner` to fold it into the task it serves (a task is a unit of behavior, not a step). **Never ask for a scenario to fill the slot**: a task whose behaviors are all `observe` / `none` is a legitimate plan, and a filler test proves nothing and is trusted forever. Note any reshaping at the gate so the human sees the plan changed. *(At every rung but `STANDARD` this check is skipped — the collapsed rungs write no test plan by design.)*

**2 · No plan task reverses a binding prohibition.** For each accepted ADR or `design.md` Zone 1 lists as bearing on this issue, extract its **explicit negative constraints verbatim** — the sentences containing *never*, *must not*, *cannot*, *is not*, *may not*. There are few of them, they are the load-bearing ones, and they are exactly the sentences a plan is most damaging to contradict. Put each beside the plan task that touches the same surface and confirm the task does not reverse it.

A plan that reverses a prohibition is a **stop-the-line — in auto mode too**, not a judgment call: an ADR is human-ratified law, and overriding one is a supersession that belongs to the `architect` conversation ([precedence](#gate-gate-design): ADR > `design.md`). In human mode, surface it at this gate and let the human decide; do not proceed on an inferred yes.

This is the only gate positioned to catch it. Everything downstream measures conformance against **the plan** — the coder builds it, the tests encode it, the reviewer reads a diff that is internally consistent with it — so a contradiction that survives this gate is never re-examined, and by review time it is baked into code, tests and commits that all agree with each other. The check is cheap because the contradiction is never subtle once the two sentences are adjacent — a prohibition and a task that reverses it read as plainly opposed. What makes it slip through is that nothing else in the loop ever places them side by side.

### Present

**Pace the panel to the rung.** A gate that arrives as one wall of text gets a `y`, because the only question it asks — *approve?* — has no answer the human can reach from what they were shown. Collapsed rungs are small enough to take in at once and stay a single panel. `STANDARD` is presented as **three beats, one message each**, and run waits for a reply between them.

Three rules hold at every beat, and they are what make the pacing worth its round trips:

- **End each beat with a question the human can settle from what they just read** — "does `validateInvite()` belong in `lib/auth/session.ts`?", not "approve?". A question they cannot answer is answered `y`.
- **"Not sure" is a first-class answer and costs them nothing** — it expands that beat (open the file, show the surrounding code, name what else lives there) and re-asks. If "not sure" is more effort than "yes", the two collapse into one keystroke and the gate is decorative.
- **Say it in the project's words.** *Rung*, *phase*, *phase_step*, *micro-loop*, *Zone 2* are this plugin's vocabulary for its own machinery; the person at this gate owns the product, not the loop. "5 tasks, test-first each" — not "STANDARD rung, TDD micro-loop × 5".

And never name a file, symbol, or scenario that isn't in `plan.md` / `test-plan.md` — everything a beat shows is read from those two files. A plausible invented filename is exactly what this gate exists to catch, and it is indistinguishable from a real one on the page.

The human can cut the pacing short at any beat ("just go", "approve"). Honor it and move to **On approval** — same flexibility valve as reshaping.

#### One panel — `TRIVIAL` · `EXPRESS` · `REFACTOR`

> **Execution plan for #[ISSUE] — [title]  ([workflow] · rung: [TRIVIAL | EXPRESS | STANDARD | REFACTOR])**
>
> [TRIVIAL:] Inert change — [why]. Docs/prose only; no test, no review, no validate — verified by the inertness proof below (the touched files feed no check).
> [EXPRESS:] Trivial change — [why]. No new test; verified by the triviality proof below + the full check suite.
> [REFACTOR:] Behavior-preserving restructure — [why]. No new test; the existing suite (coverage below) must stay green.

| Stage | What |
|---|---|
| Code | [STANDARD: TDD loop × [N] tasks (test → code per task)] [EXPRESS/REFACTOR: apply [N] change(s), no test-first] [TRIVIAL: apply [N] inert edit(s)] |
| Proof | [EXPRESS: what I'll grep to confirm nothing depends on it] [REFACTOR: the existing tests that guard the behavior — coverage adequate/THIN] [TRIVIAL: the inert files + the checks cleared against them — subset to run: [subset or none]] |
| E2E | [scenario list] |  ← omit row if e2e not active (always omitted for TRIVIAL)
| Review | [STANDARD: diff review + critique] [EXPRESS/REFACTOR: single review pass] |  ← omit if not active (always omitted for TRIVIAL)
| Validate | [K] acceptance criteria ([M] need manual check) |  ← omit for TRIVIAL (ACs confirmed at the delivery gate)
| Deliver | [branch] → [base] · [merge locally (direct) \| open PR (pr)] |

> Gates I'll stop at:
> ① now — approve this plan [STANDARD: + test strategy]
> ② after review — approve findings before fixes  ← list only active gates
> ③ after validate — verify [M] ACs manually
> ④ [direct: before merge — confirm merging to [base] \| pr: before PR — approve PR content]
>
> Approve, or reshape (e.g. "skip e2e", "skip review", "make this STANDARD", "this is a refactor", "this is just docs", "open a PR"):

#### Three beats — `STANDARD`

**Beat 1 · Where this lands.** What exists here now, and what this issue adds to it — from `context.md` Zone 1 (the surrounding code and patterns) plus `plan.md`'s `Touches:` lines. Two or three sentences. **Draw it** (ASCII, `← new`) when the change spans more than a couple of files: the sketch does this beat's job faster than sentences and leaves the human oriented for the two that follow.

> **#[ISSUE] — [title]**
>
> [what's already here, and where this change sits in it]
>
> [ASCII sketch, `← new` on what this issue adds]  ← when it spans >2 files
>
> Does that match how you think about this part of the system?

**Beat 2 · The tasks, and where the code goes.** One line per task from `plan.md`, in plain language, each with its `Touches:` files. **Mark every new *home*** — a file that does not yet exist (`+ new`), **and** a symbol landing in an existing file that Zone 1's `Where new code goes` did not name as its home (`+ new home`). Both are placement decisions, and this beat is the last moment either is free to move. Once code exists, moving it is a refactor, and the `reviewer`'s placement finding is [leashed to a named destination file](#phase-review) — it stays silent on precisely the drift a human recognises on sight. The second marker is there because the commonest drift creates **no new file at all**: a function appended to whichever existing file was nearest. A panel that only flags new files cannot show it, and asks about the case that was least likely to be wrong.

> | # | Task | Files |
> |---|---|---|
> | 1 | [what it does, in the project's words] | `path/to/file.ts` |
> | 2 | … | `path/new-file.ts` **+ new** |
> | 3 | … | `path/existing.ts` **+ new home** |
>
> [one line per marked row — `plan.md`'s `Placement:` field verbatim: why here
>  rather than beside the nearest relative]
>
> Does that land where you'd put it? (or: not sure — I'll show you what's already there)

**The rationale line is quoted, never composed.** It is `plan.md`'s `Placement:` field, which the planner wrote against Zone 1's `Where new code goes`; run does not have the file tree in hand at this gate and a justification it invents here is unfalsifiable at exactly the moment the human is being asked to trust one. If a marked row carries **no** `Placement:` line, say so plainly (*"the plan doesn't say why this file"*) — that absence is itself the answer to the beat's question, and it is the planner's to fill, not run's.

If the human moves something, re-invoke the `planner` with the destination as a constraint and re-present this beat — run does not rewrite `plan.md` itself, for the same reason it never writes a rung's licensing artifact. Log the move to Zone 2 with the **user as author**.

**Beat 3 · How it gets proven, and where you'll be asked again.** Lead with the proof — this is the one moment the human can say *"that's too much for a demo"* or *"you missed the expired-link case"* before any test exists. All of it is read from `test-plan.md` and the critique return in `## Pending gate`; never compose a scenario here.

> **What this is for:** [the Purpose reading, in plain words] — because [the quoted evidence]
>
> **Tested** — [k] behaviors, [s] cases
> - [behavior] — [happy · edge · error, one short line each]
>
> **You'll check by eye** — [m]   ← omit if none
> - [the check: do this → see that]
>
> **Not tested, on purpose** — [the edges and `none` behaviors, each with its one-line reason]   ← omit if none
>
> **The second look changed:** [what the critique added, cut, or moved between tested and by-eye] · **kept as planned, against it:** [each declined finding + the planner's reason]   ← omit if the critique was sound
>
> Is that the right amount of proof for what this is? (or: not sure — I'll show you the case)

Then the stage table and gate list from the panel above, and the approve/reshape line. Reshaping proof — *"just check the page by eye"*, *"test the permission case too"* — re-invokes the `planner` with the request as a `$TEST_CRITIQUE` finding authored by the user, then re-presents this beat; the planner's decline rule does not apply to a user's finding, except that a request to drop the test on a behavior touching data, money, auth, secrets, an irreversible operation or a consumed contract is said back once, plainly, before it is honored. Log proof changes to Zone 2 with the **user as author**.

Apply any reshaping the user asks for (drop/add a stage, switch workflow, **change the rung**). The user has final say on the rung too — and on the rung, saying so is not the same as being able to run it:

**Changing the rung re-invokes the `planner`.** A rung is a flag *plus* the artifact that licenses it, and **only the planner writes that artifact**: `STANDARD` rests on `test-plan.md`, `EXPRESS` on `plan.md`'s `## Triviality proof`, `REFACTOR` on its `## Coverage`, `TRIVIAL` on its `## Inertness proof` — and a plan carries **at most one**, the one its current rung uses. So *every* rung change leaves the plan without the artifact the new rung runs on. Re-invoke the planner with **`$RUNG`** = the requested rung — the rung is the user's call now, so it is passed as a constraint, not a question (the planner honors `$RUNG` and does not re-derive it; without `$RUNG` it would re-choose from context and hand the reshape straight back) — then re-present the new plan.

This holds in **every** direction, downgrade included. There is no honor-in-place case: an `EXPRESS` whose `## Triviality proof` run invented is run doing the planner's job, and that proof is the entire license for skipping the front half (per the planner's contract, never pick `EXPRESS` without a concrete proof you can name). Same for a `REFACTOR` with no `## Coverage` — [the collapsed path](#the-collapsed-path) greps the one and confirms the other as its **first step**, and neither is run's to write.

The planner still reports honestly *within* the mandated rung — a user-ordered `REFACTOR` over thinly-tested code comes back `Coverage: THIN`, and the collapsed path surfaces it rather than refactoring blind. The user sets the rung; they don't get to assert the evidence for it.

Log the rung change to Zone 2 with the **user as its author**. Re-present until approved. The user reshaping the plan is the flexibility valve — honor it.

**Auto-mode.** No panel and no reshaping — accept the planner's rung, execution plan, and computed gate set as built (never downgrade a rung on run's own initiative — the planner already chose it). Append a Zone 2 entry recording the plan, the rung, and the phases/gates chosen, then run **On approval** below (create branch, write the confirmed `rung:`/`phases:`/`gates:` lines, record the first execution phase) and continue. (A planner `NEEDS-CONTEXT`, `NEEDS-DESIGN`, or `MANUAL` detour is still honored — those are the planner's calls, not a gate decision.)

### On approval

1. Create the branch: `feat/issue-N-<slug>` (feature) or `fix/issue-N-<slug>` (bugfix), from `$base`. `<slug>` is the kebab-cased, truncated issue title.
2. Write the confirmed `rung:`, `phases:`, and `gates:` lines to the state file; mark `gate-plan ✓`.
3. Record `phase:` = first active execution phase (`build`, or `validate` / the delivery gate — `gate-deliver` for direct, `gate-pr` for pr — if build was dropped).

(The design workflow does not reach this gate — it ends at [gate-design](#gate-gate-design). Reshaping a feature to "this is a design task" here switches it to the design workflow and routes it through the design phase. Reshaping to "this is a manual task" switches it to the **manual** workflow and routes it to [gate-manual](#gate-gate-manual) — no branch is created.)

Continue to the first active execution phase.

---

## Gate: gate-manual

**Active in:** the **manual** workflow. *(Human gate.)* The terminal gate for an issue with no code to build — the human completes the work outside the repo and confirms the acceptance criteria here. No branch, no plan, no tests, no PR.

This gate is resumable like every other: before presenting it, write the checklist payload (the issue's acceptance criteria, plus the planner's one-line reason) to the state file's `## Pending gate` block, so a resumed session re-presents it without re-invoking the planner.

The acceptance criteria come straight from the issue body fetched at startup — run does not write a `plan.md` for a manual issue. Present:

> **Manual task — #[ISSUE]: [title]**
>
> The planner judged this has no code to build: [planner's MANUAL reason].
> Complete these yourself, then confirm each:
>
> - [ ] [acceptance criterion from the issue body]
> - [ ] [acceptance criterion]
>
> Confirm all done (y / list the ones still blocked):

Wait for the user's response.

- **All confirmed (y)** → the issue is done:
  1. Append a Zone 2 entry (`$NOW`) recording manual completion — which criteria the user confirmed.
  2. Run [Issue-complete cleanup](#issue-complete-cleanup) (no-PR variant), with the ✅ report `✅ #[ISSUE] done — manual task completed, sprint file updated.`

- **Some blocked** → the work can't be finished now. Record the blockers in a Zone 2 entry and ask how to proceed: **leave open** (exit, lock released, issue stays in-progress for a later `run`) / **abort** (`/devloop:abort` for a clean teardown and issue decision). Do not tick the checkbox or close the issue while any criterion is unmet.

**Auto-mode.** A manual issue is outside auto-mode's reach — do not attempt or fake completion. Append a Zone 2 entry and a `## Log` line recording `blocked: manual task requires human action`, leave the issue in-progress (checkbox unticked, issue open), release the lock, and exit:

> ⏸ #[ISSUE] is a manual task — auto-mode can't complete it. Do the work, then run `/devloop:run [ISSUE]` (no `--auto`) to confirm the criteria.

Plain `run [ISSUE]` is what resumes this: the missing `--auto` downgrades the recorded autonomy to `human` (S6), so the resume lands *here* as a human gate instead of re-taking this same exit. Don't tell the user to re-run with `--auto` — that resumes as auto and blocks again.

---

## The TDD micro-loop

The cycle that turns one unit of intent into committed, verified code — four steps, plus a fifth that fires only for the gate-review caller. **run uses it in exactly two places** — once per **task** in a `STANDARD` build phase, and once per **blocker** at gate-review — and steps 1–4 are identical in both. (An `EXPRESS` or `REFACTOR` build phase does not use this cycle: it has no failing test to author, so it runs [the collapsed path](#the-collapsed-path) — the collapsed front half plus the same back half — instead.) Only the **seed** differs:

| Caller | `$SEED` | `test-writer` mode | `coder` mode |
|---|---|---|---|
| build phase (per task) | the task's `Proof: test` scenarios in `test-plan.md` | `unit` | `implement` |
| gate-review (per blocker) | the review finding | `regression` | `fix` |

Defining it once is deliberate: the two callers must never drift apart, because a blocker fix that skipped the red check would be exactly as untrustworthy as a task that did.

**1 · Write the test.** Invoke **`test-writer`** with `$SEED`, the mode from the table, `$WORK_DIR`, `$NOW`, and the `design.md` path **if a design phase ran** (so tests assert the approved interfaces). It writes failing tests; it does **not** run them.

> **Narrow-interface round-trip.** A test that can only be written with an unsafe cast, a type assertion, or a poke at a private field is not a test problem — it is the **production interface** telling you it is too narrow to be used the way the behaviour requires, and the test is simply the first caller to find out. Forcing the cast buries that signal in the suite and ships the narrow interface. So the test-writer stops instead, returning `BLOCKED: narrow-interface` with the symbol, what the test needs, and the minimal widening. On that signal run **does not count a coder attempt** (nothing has failed): invoke the **`coder`** (`mode: fix`) with the widening as its task, then re-invoke the test-writer to write the test cleanly against the real API. Mechanical enough that **auto-mode resolves it without stopping** — log it to Zone 2 so the interface change is visible at review.

**2 · Verify red.** Invoke **`test-runner`** (`mode: red`) with the test files just written, `$LOG_DIR`, and `$NOW`. **Nobody else in this pipeline ever sees the failing state** — the test-writer is forbidden from running tests, and the coder arrives next with the sole job of turning them green. Without this step "the test failed first" is an assumption, and an unverified assumption is how a test that proves nothing gets into the suite and is trusted forever after.

| Verdict | Meaning | Action |
|---|---|---|
| **`RED`** | failed on a real assertion | the test is meaningful → continue to step 3 |
| **`RED-SETUP`** | failed on a broken import / syntax / fixture | **not** a meaningful test — it would go green the moment the setup is fixed, having tested nothing → back to `test-writer` with the error |
| **`GREEN`** | passed against code that doesn't exist yet (or, for a blocker, against the bug) | **vacuous** — it asserts nothing that depends on the behaviour. For a blocker this is a *real signal*: we have not understood the bug, and patching on top of that misunderstanding is how a "fixed" bug ships → back to `test-writer` |

**3 · Code.** Invoke **`coder`** with `$SEED`, the mode from the table, `plan.md` (when it exists), `context.md`, the `design.md` path **if a design phase ran**, `$NOW`, `$LOG_DIR`, **`$CHECKS`** (the profile's check commands from [S3](#s3--read-project-profile-and-baseline) — what it runs, never a guess), `$ABSENT`, and **`$ACCEPTED`** (the baseline's test ids — see S3; without it the coder cannot reach green in any project that has baselined a failure). It makes the failing tests pass and commits **only when all `$CHECKS` pass**. Building to the approved design directly is what makes the reviewer's conformance check pass by construction.

> **Missing-command round-trip.** The coder runs only the commands it is given and never guesses. If it needs a check the profile doesn't provide (e.g. there's no `typecheck` command but the code is typed), it returns `RESULT: blocked` with a `MISSING: <check>` line instead of committing. On that signal, run does not count an attempt — it asks the user:
>
> > The coder needs a **[check]** command, which isn't in the profile. What command runs it? (or `none` if this project has no [check]):
>
> Write the answer back to `.context/devloop-profile.md` (see [Profile write-back](#profile-write-back)) — or record `none` so it isn't asked again — then re-invoke the coder with the updated check set **and the `$ABSENT` list** (checks the user marked `none`), so it proceeds without re-flagging them. In **auto-mode** there is no one to ask: proceed with that check **absent for this run** and log it.

**4 · Verify green — the verdict.** Invoke **`test-runner`** (`mode: unit`) with the test files, the profile's test command (`$UNIT_CMD`), the baseline path, `$LOG_DIR`, and `$NOW`. It returns three buckets — **new / accepted / pre-existing** — plus the `LOG:` path of its captured output. Handle them per [Known-failing baseline](#known-failing-baseline). `new` failures block. (The coder already ran the full `$CHECKS`; the test-runner independently re-runs the tests, the part that classifies against the baseline.)

The coder already ran the suite, so this is usually green — that is expected, and it is not the point. This run does two things the coder's cannot: **classify** failures against the baseline (the coder sees only an exit code; "green" here means *no new failures*, not zero), and **independently verify** a result reported by the one agent that both wrote the code and wanted it to pass. The coder's green is provisional; the test-runner's is the verdict. Believe the test-runner.

**5 · Did the fix build a new layer? (gate-review caller only.)** Run `git diff --name-status` over the fix's commits. If it contains an **`A`** (added) entry under a source path, the fix did not edit code the plan described — it **created a surface that no `test-plan.md` scenario was ever written against**, because the plan predates it. The regression test cannot have covered it either: that test was authored before this code existed, from a finding's prose, and a blocker's prose describes the symptom that made the bug findable, not the surface its fix will introduce.

So loop back to the `test-writer` **once**, scoped to the new module: enumerate what it exposes and cover it (its contract in [`regression` mode](#the-tdd-micro-loop) applies — cover every element of a set, or name what you left and why). Then run `test-runner` (`mode: unit`); any failure is a `new` failure and routes to the coder like any other.

**No red-verification here, and that is not a hole.** Red proves a test is meaningful for behaviour that does not exist yet; this code already exists, so these tests are coverage of a surface, not a TDD front half — `mode: red` would return `GREEN` (vacuous) on every one that passes and bounce it back. The tests that fail are the finding; the tests that pass are retained coverage.

A fix that only **edits** existing files skips this step — those surfaces already have scenarios.

### The back-half rule

Steps 3–4 are the **back-half**: the coder runs the profile's checks `$CHECKS` (build/typecheck/unit/lint — its commit gate), and the `test-runner` independently re-runs the *tests* and classifies them against the baseline. **The back-half runs in full at every rung that has checkable surface** — `STANDARD`, `EXPRESS`, and `REFACTOR` all run the complete `$CHECKS`. For these three the rung flexes only the *front half* — steps 1–2, authoring a failing test and verifying it red: `EXPRESS` and `REFACTOR` skip it because neither carries new behavior worth pinning (`EXPRESS` because the change is trivial and nothing live depends on it, `REFACTOR` because the behavior already exists and the existing suite already pins it), but neither ever skips the back half, because the *existing* suite and fitness functions can still break. For these three, `$CHECKS` is exactly what the profile declares (S3) — a rung never drops one of them.

**`TRIVIAL` is the sole exception, and a principled one — not a hole.** Its entire definition is *no checkable surface*: the edit touches only whole inert files that feed no `$CHECKS` command (see [the collapsed path](#the-collapsed-path)). So it runs exactly the subset of `$CHECKS` whose inputs a touched path actually feeds — **usually empty** — licensed by the planner's `## Inertness proof` and re-verified against the **real post-edit `git diff`** before a single check is skipped. The invariant holds where it bites: **nothing that could observe the change is skipped.** `TRIVIAL` omits only checks that provably cannot see the touched files, and the instant the diff touches a path a check *does* feed, it [auto-bumps to `EXPRESS`](#the-collapsed-path) and runs the full suite. So "green to land" still means **every profile check that can see the change passes with no `new` failures** — which for the other three rungs is all of them, and for `TRIVIAL` is the (usually empty) consuming subset. Only the questions "was a new test authored?" and "can any check even see this?" differ across rungs.

### Bounds — every loop in this cycle is capped

Four different signals can send the micro-loop round again. They are **not** interchangeable: two are round-trips (nothing failed; a missing input is being supplied) and two are failures (something can't be made to work). All four are bounded — an uncapped retry is a hang, and in auto-mode there is no human to notice it.

| Signal | Kind | Counts as a coder attempt? | Cap | On exhaustion |
|---|---|---|---|---|
| `BLOCKED: narrow-interface` (step 1) | round-trip | no | **2** | escalate (human) / stop-the-line (auto) — a second widening that still doesn't yield a clean test means the design is wrong, not the interface |
| `MISSING: <check>` (step 3) | round-trip | no | **2** | proceed with the check absent for this run, and log it |
| `RED-SETUP` / `GREEN` (step 2) | failure | no | **2** | escalate / stop-the-line — something is wrong with the scenario or our understanding of the bug, and grinding further won't find it |
| `BLOCKED:` — tests won't pass (step 3) | failure | **yes** | **3** | escalate / stop-the-line (see the build phase) |

---

## Phase: build

**Active in:** feature, bugfix. The path depends on the confirmed **rung** (state file `rung:`).

### STANDARD path

[The TDD micro-loop](#the-tdd-micro-loop), repeated per task in `plan.md`. `task_index` is the 0-based position.

For the task at `task_index`, branch on its behaviors' proofs in `test-plan.md`:

- **Any `Proof: test` behavior** → run the micro-loop with `$SEED` = the task (test-writer `unit`, coder `implement`). The test-writer takes only the `test` scenarios; the coder builds the task's `observe` / `none` behaviors alongside.
- **Every behavior `observe` / `none`** → skip steps 1–2 (there is no test to author, by recorded decision): `coder` (`implement`) builds the task to its acceptance, then step 4's `test-runner` verdict. Do **not** send the test-writer "just in case" — that is the test the plan was critiqued to remove.

Then mark the task `[x]`, increment `task_index`, and append a log line.

**Escalation.** If `coder` cannot make the tests pass after **3 attempts** on the same task, stop the loop:

> Stuck on task [i] "[task]" after 3 attempts. Last failure:
> ```
> [output]
> ```
> How do you want to proceed? **retry** / **edit the plan** / **accept as known-failing** (needs a tracking issue) / **abort** (`/devloop:abort`)

When all tasks are `[x]`, record `phase:` = next active phase (`e2e` if active, else `review`). Continue.

### The collapsed path

`EXPRESS`, `REFACTOR`, and `TRIVIAL` all skip the test-authoring **front half** of the micro-loop (no test-writer, no red-verify). `EXPRESS` and `REFACTOR` keep the **back half** in full ([the back-half rule](#the-back-half-rule)); `TRIVIAL` runs only the inert-file check subset (usually empty) and its verification is empirical on the diff. They differ only in the **proof** that licenses skipping the front half — each has exactly one:

| Rung | The change | Proof | If the proof does not hold |
|---|---|---|---|
| **EXPRESS** | trivial; nothing live depends on the touched code | **triviality** (runs *first*) — grep the `## Triviality proof` targets: callers of a removed symbol → zero, readers of a changed constant → none coupled, the named blast radius → empty | the change isn't trivial → **auto-bump to STANDARD** |
| **REFACTOR** | behavior-preserving restructuring of code that *is* used | **coverage** (runs *first*) — the existing suite exercises the behavior being restructured: confirm the tests the planner named in `## Coverage` pass on the **current** code (the green the refactor must preserve) | coverage is `THIN`/absent → can't refactor blind → **surface** (human: add coverage first / accept the risk; auto: **stop-the-line**) |
| **TRIVIAL** | inert; touches only whole files that feed no check | **inertness** (runs *after* the edit) — `git diff --name-only` ⊆ the `## Inertness proof` targets, each a file no `$CHECKS` command consumes | a touched path is checkable, or is outside the named targets → **auto-bump to EXPRESS** (run the full `$CHECKS`) |

**EXPRESS and REFACTOR** — per task in `plan.md`, prove *first*, then apply:

1. **Run the rung's proof** (table above), capturing output to `$LOG_DIR`. On EXPRESS the proof failing means the rung was mis-called → **auto-bump to `STANDARD`** (re-invoke the `planner` with **`$RUNG`** = `STANDARD` for a `STANDARD` plan — `test-plan.md` and all — run the [test critique](#phase-plan) on that new `test-plan.md`, set `rung: standard`, log to Zone 2 `Caught by: validation`, restart this phase on the STANDARD path). The bump is a **one-way ratchet** — a rung only ever moves up — so no cap. On REFACTOR, `THIN` coverage is not a bump but a **surface/stop** as in the table (you don't fix under-coverage by adding ceremony to the refactor; you add coverage first).
2. **Apply the change.** Invoke **`coder`** (`mode: express` — apply the change; there is no authored test to turn green, so success = the profile's checks pass) with `$SEED` = the task, `plan.md`, `context.md`, `$NOW`, `$LOG_DIR`, **`$CHECKS`**, `$ABSENT`, and **`$ACCEPTED`**. It commits only when all `$CHECKS` pass. (The `MISSING: <check>` round-trip applies here too.)
3. **Verify — the verdict.** Invoke **`test-runner`** (`mode: unit`) with the profile's test command (`$UNIT_CMD`), the baseline, `$LOG_DIR`, `$NOW`. Three buckets; `new` failures block, and what a `new` failure *means* is the crux of each rung:
   - **EXPRESS** — a new failure means the change touched real behavior after all → **auto-bump to STANDARD** (there *is* something to fix and guard).
   - **REFACTOR** — a new failure means the restructuring **changed behavior**, which is the one thing it must not do → the `coder` fixes it (still REFACTOR — the fix is to restore the behavior, not to add a feature); unfixable after 3 attempts → escalate / stop-the-line.

   Then mark the task `[x]`, increment `task_index`, log.

**TRIVIAL** inverts the order — there is no forward proof to run, so it applies *then* proves the diff inert (the proof is empirical on the real diff, not a prediction). Per task:

1. **Apply the inert edit.** Invoke **`coder`** (`mode: express`) with `$SEED` = the task, `plan.md`, `context.md`, `$NOW`, `$LOG_DIR`, `$ABSENT`, `$ACCEPTED`, and — as its check set — **only the `## Inertness proof` `Subset to run`** (usually empty), *not* the full `$CHECKS`. With an empty subset the coder simply applies the edit and commits; running the whole suite on an inert change is exactly the waste `TRIVIAL` exists to avoid. (The full `$CHECKS` returns only on an auto-bump to `EXPRESS`.) If the coder returns `RESULT: blocked` / `NOTE: not-trivial` — the "inert" edit turned out to need real code — that is itself the signal the rung was mis-called → **auto-bump to `EXPRESS`** (below), which runs the full `$CHECKS` and can bump onward to `STANDARD`.
2. **Verify inertness on the diff.** Run `git diff --name-only` for the task's commit and confirm every touched path is (a) within the `## Inertness proof` targets and (b) a file **no** `$CHECKS` command consumes (per the proof's cleared-checks list). If it holds, run only the checks a target *does* feed — the `## Inertness proof` `Subset to run` (usually empty), via `test-runner` (`mode: unit`) when that subset includes tests. If it does **not** hold — a touched path is checkable, or lands outside the named targets — **auto-bump to `EXPRESS`** (re-invoke the `planner` with **`$RUNG`** = `EXPRESS`, set `rung: express`, log to Zone 2 `Caught by: validation`, restart this phase on the EXPRESS path, which runs the full `$CHECKS`; a check then failing bumps onward to `STANDARD`). One-way ratchet, no cap.

   Then mark the task `[x]`, increment `task_index`, log.

When all tasks are `[x]`, record `phase:` = next active phase. For `EXPRESS`/`REFACTOR`: `review` (single-pass) — else `validate`. For `TRIVIAL`: skip straight to the **delivery gate** (`gate-deliver` / `gate-pr`) — no review, no validate. Continue.

---

## Phase: e2e

**Active in:** feature, bugfix — only if `test-plan.md` has e2e flows marked `Proof: test`. Skipped silently otherwise; an e2e flow marked `Proof: observe` is not built here — its check goes to [validate](#phase-validate) with the other by-eye checks.

If the profile has no `e2e-test` command but the plan expects e2e:

> The plan includes E2E scenarios but the profile has no `e2e-test` command. Provide one now (I'll save it), or skip E2E for this issue? (command / skip)

Invoke **`test-writer`** (`mode: e2e`, with the profile's e2e framework as `$FRAMEWORKS` — never an assumed one) to write the tests for the `Proof: test` flows, then **`test-runner`** (full mode) — it starts the `dev-server` from the profile, runs the e2e suite, and returns the three buckets. Handle failures per [Known-failing baseline](#known-failing-baseline); a `new` failure goes to the `coder` (`fix`).

**No `red` check here, and that is deliberate.** These tests are written after the build, against code that already exists: `red` would return `GREEN` on every good one and bounce it back. A failing e2e test is a real defect found; a passing one is retained coverage (`skills/run/test-strategy-spec.md` § 6).

Record `phase: review`. Continue.

---

## Phase: review

**Active in:** feature, bugfix — at rung `STANDARD` (two passes) or `EXPRESS`/`REFACTOR` (single pass). **Not active at `TRIVIAL`** — an inert edit has no executable surface for the code-review rubric, so the phase is dropped at gate-plan and the human sees the diff at the delivery gate instead. Both reasoning passes are **delegated to agents** so run holds only the structured verdicts, not the diff. `phase_step` tracks position (`reviewed` → `critiqued` → `gated`). *(Human gate: gate-review.)*

**Rung shapes the review depth.** `STANDARD` runs **two passes** (review + fresh-instance critique — steps 1–2). `EXPRESS` and `REFACTOR` run a **single pass** (step 1 only): the change carries no new behavior and its proof already ran (triviality / coverage), so one set of fresh eyes is proportionate — but it is never *zero* eyes for a code change. Skip step 2 for both; go straight from step 1 to the gate with only the pass-1 findings. (If pass 1 on an `EXPRESS` change surfaces a **blocker**, that contradicts the triviality claim → auto-bump to `STANDARD` and re-review with the critique pass. A blocker on a `REFACTOR` change is a real finding to fix in place — the refactor is non-trivial by definition, so it stays `REFACTOR`.)

**This bump is the one rung change that does *not* re-invoke the planner** — the deliberate exception to [the rule at gate-plan](#gate-gate-plan), and it is an exception because there is nothing left for the planner to write. That rule exists because a rung is a flag *plus* its licensing artifact, and the artifact governs the **front half**: a plan re-planned as `STANDARD` yields a `test-plan.md` for the test-writer. Here the build phase has already run and committed — there is no front half left to license. What this bump buys is the *back* half only: a second pair of eyes (the critique pass), and the blocker itself is pinned by [the mini-TDD loop](#the-tdd-micro-loop) at step 4, which writes its own red-verified regression test. So set `rung: standard` for the review depth, log the bump, and do **not** re-plan; `plan.md` keeps its now-falsified `## Triviality proof`, which is the honest record — the proof was wrong, and Zone 2 says so.

1. **Review** (`phase_step: reviewed`). Derive `$NOW` and invoke **`reviewer`** (`mode: review`), passing **`$BASE`** = the state file's `base:` branch, **`$HEAD`** = the issue branch tip, `$WORK_DIR` (absolute, per [S1](#s1--resolve-the-active-sprint) — it reads `plan.md`/`context.md` and appends its Zone 2 entry there), **`$CHECKS`** (reference only — the reviewer never runs a build or the suite), the `design.md` path as **`$DESIGN`** if a design phase ran, and `$NOW`.

   **Record it done before you read it.** The moment the reviewer returns, write `phase_step: reviewed` and the findings into `## Pending gate` — before parsing the findings or doing anything with them. This pass is the most expensive call in the loop and it is **not idempotent**: a second instance returns a different finding set, and merging two pass-1 results is not a thing this skill defines. On resume, if `phase_step` is ambiguous, settle it with the last-Zone-2-entry check in [Resume](#how-this-skill-works) — never by re-reviewing "to confirm".

   **Enumerate the range; never leave it to be inferred.** run holds the verdicts, not the diff — the reviewer computes the diff itself, so `$BASE`/`$HEAD` *are* the review's scope, exactly as `$CHECKS` is the coder's. And this parameter fails the way a guessed MCP tool name does, not the way a missing file does: an improvised range returns confident, well-formed findings about the wrong code — or `FINDINGS: 0` on an empty diff — and nothing distinguishes either from a clean review. The reviewer diffs **three-dot** (`$BASE...$HEAD`), so only this issue's commits are in scope; anything merged into `$base` since the branch split stays out (run doesn't rebase until [merge](#phase-merge), so a branch reaching review *is* routinely behind).

   It returns findings across its rubric — correctness bugs, **test-pass-insufficient** (the bug class a green suite cannot rule out: the code runs but takes a lucky path, or it never runs at all — including the sweep for newly exported symbols nothing calls), **impact/blast-radius**, **risk** (security, data loss, irreversible operations, concurrency hazards), design conformance, placement/cohesion, simplicity (YAGNI/DRY/reuse), and consistency — each classified `blocker` or `refactor`.

   **It is the same rubric a PR gets, deliberately.** Risk and blast-radius are not PR questions; they were simply first written where a human happened to be standing. This pass runs on **every** delivery path, and on the default one (`direct`) there is no PR, no CI, and no human between it and `main` — so the rubric must never be thinner here than on the path that has all three. **If a `design.md` exists** for this issue, pass its path: the reviewer also checks the implementation conforms to the approved design's **binding** half — interfaces, signatures, contracts, module boundaries; its code blocks are sketches, not law — so the design actually governs the code rather than just preceding it.

2. **Critique** (`phase_step: critiqued`) — *STANDARD only; skipped for EXPRESS and REFACTOR*. Derive a fresh `$NOW` and invoke **`reviewer`** again as a **fresh instance** in `mode: critique`, passing pass 1's findings as **`$FINDINGS`**, the **same `$BASE`/`$HEAD` pass 1 reviewed** (both passes diff three-dot, so they judge the identical range — a second opinion on a *different* diff is not a second opinion), `$WORK_DIR`, the `design.md` path as **`$DESIGN`** if one exists, and `$NOW`. Because it shares no memory with pass 1, it is an independent second opinion: for each finding it returns `uphold` or `drop` with one-line reasoning. run does this reasoning *nowhere itself* — it just collects the two structured returns.

   **`$DESIGN` is not optional here.** Critique must rule on pass 1's design-conformance findings, and without the document it is judging a citation it cannot read — so it drops the finding as "not worth the churn", which is the whole failure this pass exists to prevent.

   It may also return **`NEW`** findings — bugs pass 1 missed. This channel is restricted at the agent to **blocker-class correctness only** (never simplicity, style, or nits; see the agent's contract for why an unrestricted channel would never converge). The fresh instance is the only second look this diff gets before it merges, and it would be perverse to have it spot a real bug with nowhere to put it — so `new` findings are treated exactly like upheld blockers from here on.

3. **gate-review** (`phase_step: gated`). Merge the two passes and present grouped:

   > **Review — #[ISSUE]**
   >
   > **Upheld ([n])** — both passes agree; will be addressed
   > - [blocker|refactor] [file:line] [finding]
   >   ↳ [blockers only: what breaks, and on what input — one line]
   >
   > **New from critique ([n])** ⚠ — the second pass caught these; pass 1 missed them
   > - [blocker] [file:line] [finding]
   >   ↳ [what breaks, and on what input]
   >
   > **Dropped ([n])** — critique judged these not worth acting on: [reasoning]
   > **Disputed ([n])** ⚠ — review flagged, critique disagreed (or vice-versa); your call
   > - [blocker|refactor] [file:line] [finding] — [each side's one-line reasoning]
   >   ↳ [blockers only: what breaks, and on what input]
   >
   > Override any verdict, or confirm to proceed:

   "Disputed" = the two passes disagree; surface these for the user, who has final say on everything. Omit any bucket with no findings.

   **Blockers and disputed findings carry a failure scenario; the other buckets stay lists.** A finding is written agent-to-agent — it names the defect, not what it costs — and a human deciding *uphold or drop* is being asked for exactly the judgment that line withholds. So each blocker gets one added line: the input or state that triggers it, and what the system does wrong. Take it from the reviewer's return; if the return does not support one, say so rather than inventing a scenario (a plausible invented failure is unfalsifiable at this gate and gets upheld on sight). Upheld refactors and dropped findings need no scenario — the first are being applied anyway and the second are being left, so neither turns on a decision the human is making here. Present in the project's words: "the invite check is skipped when the token has already expired", not "guard clause unreachable in `validateInvite`".

4. **Apply.** There is no separate refactor agent — fixing is the coder's job in `fix` mode. But the two classes of finding are applied differently, because they mean different things:

   **Blockers** (upheld, new-from-critique, or disputed-and-confirmed) **ship with a regression test.** A blocker is by definition a bug the **entire suite already ran over and did not catch** — that is why a reviewer had to find it by reading code. So re-running that same suite after a bare patch proves nothing: it was green before the fix and it will be green after, whether or not the fix works. So each blocker goes through [the TDD micro-loop](#the-tdd-micro-loop) with `$SEED` = the finding (test-writer `regression`, coder `fix`) — same steps and same bounds as a build task, **plus step 5**, which fires when the fix adds a source file rather than editing one. Now the fix is proven to work, and the bug cannot come back unnoticed.

   **Not every blocker can be pinned by a test** — a divergence from the approved design, a bug whose trigger depends on timing you cannot force deterministically, a finding about code with no observable behaviour. The test-writer returns `NOT-REPRODUCIBLE: [why]` rather than faking a test that passes for the wrong reason (which would be worse than none, because it would be trusted). Skip steps 1–2, apply the fix, and **record the reason in Zone 2** — a blocker shipping untested is exactly what a human should see at review.

   **Refactors** change no behaviour, so they get **no new test** — they skip steps 1–2 of the micro-loop entirely: `coder` (`mode: fix`) applies each accepted one, `test-runner` (`unit`) verifies nothing broke. In human mode each is offered to the user first. If any refactor was applied and e2e is active, re-run `test-runner` (`full`) to catch regressions.

**Auto-mode.** No panel. Resolve each finding by verdict and log every call: **upheld** (both passes agree) blockers and refactors are applied; **new from critique** are applied (they are blocker-class by construction); **disputed** (the passes disagree) blockers are applied (safe = fix the possible bug), disputed refactors are skipped (safe = don't churn working code); **dropped** findings are left. Apply exactly as in step 4 — blockers through the mini-TDD loop (regression test first, red-verified), refactors bare. If a fix can't be made to pass, or a regression test can't be made to go red in two tries, that routes through the build-phase escalation → **stop-the-line**. The Zone 2 entry below records each per-finding decision and its reasoning, attributed to `run (auto)`, including any blocker that shipped `NOT-REPRODUCIBLE` and why.

Append a Zone 2 entry (`$NOW`) recording the gate outcome — which findings the user (or, in auto-mode, run) upheld, dropped, or overrode — so validation sees the decision. Set **`Caught by:`** per applied finding (`reviewer` for pass 1, `critique` for one pass 1 missed), and cite the regression tests written and the `test-runner` logs under **Artifacts**. This is what lets `/devloop:review` later tell a human *how* a bug was found rather than guessing — and, across issues, which gates are earning their keep.

Record `phase: validate`. Continue.

---

## Phase: validate

**Active in:** feature, bugfix — at rung `STANDARD`, `EXPRESS`, `REFACTOR`. **Not active at `TRIVIAL`** — an inert edit exposes no symbol for a reachability trace to reach, and its ACs are prose outcomes the human confirms from the diff at the delivery gate. *(Human gate: gate-validation, if manual ACs exist — or if any AC failed its reachability trace, which is an unmet AC and always gets a human in human mode.)*

Cross-check the issue's acceptance criteria and Definition of Done against what was delivered. `phase_step`: `auto-checked` → `gated`.

- **Automated ACs / DoD** (test-backed): an AC is satisfied when a passing test covers it **and** the behavior it asserts is **reachable from a production entry point**. Both halves are required — see [Reachability](#reachability-a-green-test-is-not-a-satisfied-ac) below. "PR merged to main" cannot be checked yet — leave it.
- **By-eye checks** — every `Proof: observe` check in `test-plan.md` (unit behaviors and e2e flows). The plan decided a person's check is the right proof for these, so they are presented with the manual ACs below — never automated here, and never written to `.context/devloop-unproven.md` (that ledger is for a test that was due and overridden; a row there comes back as test work at sprint close).
- **Manual ACs** (user-visible behavior with no test): present at **gate-validation**:

  > **Validate — #[ISSUE]**
  >
  > Verified automatically (test + reachable):
  > - [x] [criterion] (unit) — reached via `[traced path]`
  > - [x] [criterion] (e2e) — reached via `[traced path]`
  > - [x] Code reviewed
  >
  > [⚠ Green but unreachable — no production call path:]        ← only if a trace came up empty
  > [- [ ] [criterion] — `[symbol]` is called only by its own test]
  >
  > Please verify manually:
  > - [ ] [criterion — e.g. "error toast appears on wrong password"]
  > - [ ] [by-eye check from the plan — do this → see that]
  >
  > Confirm each is met (y / list the ones that fail):

### Reachability: a green test is not a satisfied AC

**"A test covering this AC passes" and "the system does this" are different claims, and this phase is the only gate positioned to notice the difference.** A unit test verifies a symbol against *its own contract*; it is structurally incapable of noticing the symbol has no callers. Typecheck and lint accept an exported symbol nobody imports. The `reviewer` sees a module and its tests land together, freshly written and green, and it *looks complete*. Nothing in the diff announces "and nothing calls this." So the artifact ships — implemented, tested, documented, green, and **unreachable**.

So for **each automated AC**, do not ask *"is this test-backed?"* — ask **"what production call path exercises this?"** and answer it concretely:

1. Identify the symbol(s) the AC rests on (the function, guard, validator, schema, route, or resolver the tests assert against).
2. `grep -rn <symbol>` across production sources — the **non-test** tree.
3. **Name the path**, composition root inward: `AC1 → src/index.ts → createApp() → src/feature/handler.ts:41 → handleRequest()`. A path must terminate at a real entry point (CLI command, HTTP route, exported package API, scheduled job, composition root) — not at another untested, uncalled module.
4. **Name the producer.** For each value the AC's assertion depends on — a key, an index, an ordering column, a hash, a derived id or timestamp, a serialized field — name the production code that *writes* it. **One hop back, then stop:** the immediate producer, not the whole upstream graph. Then check the `test-writer`'s `FIXTURE-BYPASS:` lines in Zone 2: if the AC's truth rests on a value a **test supplied by hand** rather than one the named producer emits, the AC is **not verified** — the test proves the consumer behaves given an input production may never generate.
5. **Name what comes back.** Where the AC is about what a caller *receives* — an API reply, a serialized result, an ordered read, a status — say what the caller gets and **whether anything has ever exercised that return**. One hop out, then stop. This is a grep over the tests, not an execution: if the surface exposes N elements (routes, tools, handlers) and the tests have only ever driven one of them through the real boundary, say `1 of N` — that ratio is the finding.

Steps 1–3 run **forward** and answer *does control reach the code*. Steps 4–5 are the two directions a forward grep is structurally blind to, and each is bounded at one hop so this stays a grep per AC rather than an unbounded reading task.

Four failure shapes, all **unmet ACs**:

- **Nothing calls it.** The symbol's only references are its own definition and its own test file. The AC is satisfied *as a library function* and unsatisfied *as a behavior of the running system*.
- **Something calls it, but nothing real feeds it.** The symbol is imported, but the only inputs it ever validates or resolves are objects the tests construct — or a value the production writer computes differently from the fixture that stands in for it. A fixture that hand-writes a value the write path derives asserts on a state the system may never reach, and it stays green through any fix and any regression, because it never touches the code that assigns it.
- **It runs, and what comes back is unusable.** The call path is real end to end and the reply is malformed — a wrong shape, a dropped payload, an error swallowed into a success. The work commits and the caller is told it failed, which is worse than a plain failure: the caller cannot tell that case apart from one where nothing happened, so its only safe move is to retry something that already succeeded.
- **The declared return is unreachable.** The traced path guarantees the symbol throws — every branch into it either throws or is impossible given the caller's preconditions — so its signature promises a value the running system never produces. The function's contract and its actual role differ; that is a finding, not a satisfied AC.

**What this trace proves, and what it does not.** It proves control *reaches* the code, that the values it rests on come from production, and that someone has exercised the way back out. It is still static: it does not prove the value is *correct*, only that it is produced and observed by something other than the test asserting on it. Correctness is the `reviewer`'s, and behaviour under real conditions is the outer-loop demo's. Claiming more than this is how a phase that traces arrival gets read as a behavioural check.

The cost is a grep per AC. **Never tick an AC because its test is green when any of these comes up empty** — that tick is precisely how a green, unreachable module sails into `main` with a checkmark beside it.

If any AC or required DoD item is unmet — including any that **failed the reachability trace**:

> [k] of [total] criteria are unverified: [list]. Create the PR anyway? (y/n)

**Block with override** — proceed only on explicit `y`. On `n`, return to the relevant phase (build for a failed behavior or a missing production call path, e2e for a failed flow). Re-entering an earlier phase re-runs the phases after it that are affected by the change (e.g. a build fix re-runs review and validate); unaffected completed phases are not redone.

**Auto-mode.** The **trace runs exactly as above, all five steps** — it is mechanical, it needs no human, and auto-mode is where it matters most, because nobody is looking at the diff before it merges. A failed trace is **not** a flag to carry forward: unlike a manual AC that *can't* be automated, each of the four shapes is a **demonstrable defect** — the code was never wired in, the producer cannot emit what the test assumed, the reply is malformed, the return is unreachable. Route it back to **build** as one scoped task (coder → test-runner → review, as any build fix). Attempt this **once per AC**; if the fix can't be made without a decision the run isn't entitled to make — which entry point should call this, whether the producer or the test is the wrong one, whether the design intended this path at all — **stop-the-line**: log the blocker with the failed trace and exit, exactly as anywhere else auto-mode would escalate.

**By-eye checks are not automated.** A `Proof: observe` check — and a manual AC whose behavior the plan marked `observe` or `none` — is carried forward as `needs manual verification` exactly as written in `test-plan.md`. Writing a test for it here would silently reverse a critiqued decision about what proof is enough, which is how a plan sized for a demo grows a suite anyway.

For each **other manual** AC — one the plan made no proof decision about — best-effort to remove the human dependency: invoke `test-writer` + `test-runner` to write a test that exercises the behavior. If it passes, the AC is genuinely verified — *and it still needs a reachability trace, for the same reason: a test the loop wrote itself is the loop vouching for the loop.* If the new test *fails* (the behavior is actually broken), that is a `new` failure → handle per the baseline (coder fix; unfixable → **stop-the-line**). If the behavior can't be meaningfully automated, mark the AC **unverified**, log it, and carry it forward as a `needs manual verification` flag — into the PR body when `delivery: pr`, or (direct) recorded in Zone 2 for the human to confirm in the outer-loop review — never waive it silently. Auto-mode does **not** stop at gate-validation; unverifiable ACs travel forward as flags for the human to confirm during review.

Append a Zone 2 entry (`$NOW`) recording the validation outcome — which criteria were confirmed (and how — auto-test vs already test-backed), **the traced production call path for each automated AC** (verbatim, e.g. `AC1 → src/index.ts → createApp() → src/feature/handler.ts:41 → handleRequest()`), **the producer named at step 4 and the return-path answer from step 5** (including any `N of M` ratio, and any AC resting on a `FIXTURE-BYPASS` value), which the user waived on override, and (auto-mode) which were left `needs manual verification`. Where a step could not be answered — no runnable surface, no producer identifiable — **say so explicitly** rather than omitting it, so the outer loop knows which half of the round trip was never checked instead of reading silence as a pass. A trace that failed at any step is a defect found here: record it with **`Caught by: validation`**, and cite the grep under **Artifacts**. The traces are not bookkeeping — `/devloop:review` reads them at the outer loop, where a human would otherwise reconstruct them by hand, which is how this class of defect gets found late instead of here.

Record `phase:` = the delivery gate (`gate-deliver` if `delivery: direct`, `gate-pr` if `delivery: pr`). Continue.

---

## Gate: gate-deliver

**Active in:** feature, bugfix when `delivery: direct`. *(Human gate.)* The delivery gate for a **local merge** — no PR is created.

Resumable like every gate: before presenting, write the payload (the summary + validation checklist) to the state file's `## Pending gate` block, so a resumed session re-presents it without re-deriving.

Present:

> **Ready to merge — #[ISSUE]: [title]**
> [branch] → [base]  ·  direct merge, no PR
>
> [one-paragraph summary from `plan.md`]
> [validation checklist — incl. any `needs manual verification` items]
> [TRIVIAL only — no validate phase ran, so confirm the prose ACs from the diff here:]
> [- [ ] [acceptance criterion — e.g. "README documents the new env var"]]
>
> Merge to [base] now? (y / edit / open a PR instead)

- **y** → record `phase: merge` and continue to the [merge phase](#phase-merge) (direct variant). (For `TRIVIAL`, a `y` also confirms the prose ACs listed above — append a Zone 2 entry recording them as human-confirmed.)
- **edit** → adjust the summary / merge-commit message, re-present.
- **open a PR instead** → switch to `delivery: pr` (update the state file), record `phase: gate-pr`, and continue there. The escape hatch when a change turns out to want a PR after all.

**Auto-mode.** No panel. A direct auto run merges within the run — this is its authorized endpoint. Append a Zone 2 entry, record `phase: merge`, and continue straight to the [merge phase](#phase-merge).

---

## Gate: gate-pr

**Active in:** feature, bugfix when `delivery: pr`. *(Human gate in human mode.)*

Push the branch. Create the PR via GitHub MCP:
- Title: the issue title.
- Body: `Closes #[ISSUE]`, a one-paragraph summary from `plan.md`, and the validation checklist (incl. any `needs manual verification` items).

Present (human mode):

> **PR ready — #[ISSUE]**
> [branch] → [base]
> [title]
>
> [body preview]
>
> Approve to open the PR for review? (y / edit)

On approval, record `pr:` = the PR number and `phase: pending-review`. Continue. In **human + pr** mode the run **halts** at pending-review so the human can review the PR (`pr-review` / `pr-fix`) before merging.

**Auto-mode.** Build the body and open the PR without the approval prompt. An **auto + pr** run does **not** halt — record `pr:`, append a Zone 2 entry, record `phase: merge`, and continue to the [merge phase](#phase-merge), which merges the PR through (required checks / branch protection gate the merge if configured). `--auto` is the authorization to merge.

---

## Phase: pending-review

**Active in:** feature, bugfix when `delivery: pr` and `autonomy: human` — the only cell that halts before merge. The hand-off point.

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

**Active in:** feature, bugfix. Reached from `gate-deliver` (direct), from `gate-pr` / `pending-review` (pr), or directly from Startup S4 when the issue is already closed. Branches on `$DELIVERY`.

### delivery: direct

No PR. Land the branch locally:
1. Rebase the branch on `$base` if behind. A conflict → surface it and stop (ask the user to resolve manually or `/devloop:abort`).
2. Merge the branch into `$base` locally (git **squash** by default, so the issue lands as one commit), with `Closes #[ISSUE]` in the commit message. Push `$base`.
3. Run [Preserve the history](#preserve-the-history) — **before** the branch is gone. Then delete the feature branch.
4. Run [Issue-complete cleanup](#issue-complete-cleanup): pushing `Closes #[ISSUE]` to the default branch auto-closes the issue — verify it closed; if `$base` is **not** the default branch (no auto-close), close it explicitly per the no-PR variant.

✅ report: `✅ #[ISSUE] done — merged to [base], issue closed, sprint file updated.`

### delivery: pr

Re-check the PR state via GitHub MCP. **"Approved"** means a formal GitHub approval **or** the `status:reviewed` label is present with no open `REQUEST_CHANGES` review — the label is how a solo developer's `pr-review` signs off, since GitHub forbids approving your own PR.

| PR state | Action |
|---|---|
| merged | skip merge → cleanup |
| open, approved | rebase if behind base, then merge |
| open, not approved | `PR #[pr] is not approved yet — run /devloop:pr-review and /devloop:pr-fix first.` → exit |

**Merge method:** use the repo's single allowed method if only one is enabled; if several are, ask once:

> Merge #[pr] by **squash / rebase / merge commit**?

(**auto + pr** reaches merge directly from gate-pr; for it the "not approved" row does not bar the merge — `--auto` *is* the standing approval — but required checks / branch protection still gate it, and rebase-if-behind and the conflict rule still apply. In auto mode, when several merge methods are enabled pick **squash** if available, else the first allowed method, and log the choice instead of asking.)

If a rebase hits a conflict, surface it and stop — ask the user to resolve manually or `/devloop:abort`.

Once merged, run [Preserve the history](#preserve-the-history). The merge SHA comes back from the merge call; the local feature branch still holds the per-task commits even after GitHub deletes the remote head, so archive from it.

✅ report: `✅ #[ISSUE] done — PR #[pr] merged, issue closed, sprint file updated.`

### Preserve the history

A squash lands the issue as **one** commit on `$base`, and the feature branch's commits — one per plan task, the record of *how the issue was actually built* — become unreachable the moment the branch goes. The `coder` already cites its per-task SHAs in Zone 2 (`implemented [task] → [sha]`); without this step those citations dangle, and `/devloop:review` has nothing to resolve them against.

Two records, both cheap, and the first must happen **while the branch still exists**:

1. **Archive the branch.** Point a ref at its tip so the objects stay reachable through `gc`:

   ```
   git update-ref refs/devloop/issue-[ISSUE] <branch-tip-sha>
   ```

   A custom ref namespace — not a branch, not a tag: it keeps the commits alive without showing up in `git branch` or `git tag -l`. **Local only; do not push it.** `review` runs on the machine that ran the sprint (it reads `.context/`), so local reachability is exactly what it needs, and `git log $base..refs/devloop/issue-[ISSUE]` replays the build task by task for as long as the clone lives.

2. **Record both refs** in the state file (they ride along to `run-state-final.md` at cleanup, which is what `review` reads) and in a Zone 2 entry:

   ```
   merge-commit: <sha on $base>
   history-ref:  refs/devloop/issue-[ISSUE]
   ```

   The merge SHA is what lets `review` anchor the task's diff **exactly** (`git show <sha>`) instead of grepping `$base` for `Closes #[ISSUE]` — a substring match that finds `#4` inside `#42`.

If `update-ref` fails, log it and continue: the merge is done, the merge SHA is the load-bearing record, and the archive is a bonus. Write `history-ref: -` so `review` knows there is nothing to look for.

(Scaffold commits straight to `$base` and has no branch to archive — record its commit range as `merge-commit:` and leave `history-ref: -`. Design and manual workflows produce no commits at all.)

### Issue-complete cleanup

The terminal cleanup every workflow ends with — referenced by the design terminal, gate-manual, and scaffold so the steps stay identical:

1. **Close the GitHub issue as appropriate:**
   - **PR merge, or a direct merge to the default branch** — the `Closes #[ISSUE]` keyword already closed it. Verify; nothing to do.
   - **No-PR variant** (design, manual, scaffold — workflows that produced no PR) **or a direct merge to a non-default base** (no auto-close): **offer to close the issue** (`Close #[ISSUE] on GitHub? (y/n)`; on **y**, close via GitHub MCP with a comment noting how it was completed).
2. Tick the issue's checkbox `[x]` in `$SPRINT_FILE`. Touch only the checkbox. Neighboring lines may already carry a trailing `✓accepted YYYY-MM-DD` from a prior `review` — do not copy that annotation onto this line or any other; it is `review`'s marker alone, and `run` writing it here would make an unreviewed, auto-merged issue look human-accepted.
3. **Archive the state file, then release the lock.** Move `.context/sprints/state/issue-N.md` → `.context/sprints/work/issue-N/run-state-final.md` (this preserves its `## Log` — the script-timestamped run history — plus the confirmed plan and tasks, for post-mortem reference), then delete `.context/sprints/state/.lock`. Do **not** leave `issue-N.md` in `state/`: a completed issue's file lingering there would read as *in-progress* to a future `run` (Startup S4).
4. **Append the journal line** — one line to `.context/devloop-journal.md`, per [The project journal](#the-project-journal--one-line-per-episode) and `skills/tinker/journal-spec.md`:

   ```
   - YYYY-MM-DD · run #[ISSUE] · shipped · `<areas>` · [what shipped, and why anything non-obvious is that way] → `sprints/work/issue-[ISSUE]/`
   ```

   Append with `cat >>`, **never `Edit`**. Script-derive the date. Take the areas from `git diff --name-only` over the issue's own range and collapse to globs — **mechanically, never composed**. This is the only record a *later* issue will read; the work dir is read by `review` and by nothing else.
5. Leave `work/issue-N/` in place (useful for reference) — it now also holds `run-state-final.md`.
6. Print the terminal's one-line ✅ report (each terminal supplies its own wording — the delivery variants above supply the merge-path wording), then ask **"Move to the next issue? (y/n)"** — on **y**, return to **Startup S4** as the no-arg case (pick the next unchecked issue); on **n**, exit cleanly. **Auto mode skips this prompt** and exits cleanly after the report — one invocation handles one issue; sprint-level sequencing belongs to `/devloop:sprint`, not to run.

---

## Scaffold workflow

**Phases:** context (light) → scaffold → profile write-back → done. No branch, no tests, no PR.

After the light context phase, invoke **`scaffolder`** with the issue, `$REPO`, and the intended structure. It creates the repo (if needed), bootstraps the project structure (`api/`, `web/`, `types/`, etc.), and commits directly to the base branch. The scaffolder checks for existing files/dirs before creating, so a resumed scaffold (crash before profile write-back) doesn't duplicate or clobber what the previous run already created.

Then capture what the scaffold established — build/test/lint commands, test layout, frameworks — and run [Profile write-back](#profile-write-back) so later issues inherit them.

Then run [Issue-complete cleanup](#issue-complete-cleanup) (no-PR variant), with the ✅ report:

> ✅ Scaffold complete for #[ISSUE]. Project profile updated with the new commands.

---

## Known-failing baseline

`.context/devloop-baseline.md` is the shared allowlist of accepted-failing checks. The green-check gate is **no `new` failures**, not zero failures.

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

**Accept as known-failing** — require a tracking issue (reference an existing one or create a `type:bug` issue now), then append to `.context/devloop-baseline.md`:

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

`.context/devloop-profile.md` is machine-maintained. run updates it in two cases:

1. **Scaffold** established the project's commands → write them all.
2. A task **filled a previously-empty field** (e.g. the first test script was added) → offer to record it.

Do **not** diff or rewrite on every commit. Before writing, confirm:

> The project now has a [field] command: `[command]`. Save it to the profile so future runs use it? (y/n)

Write only the confirmed fields; never overwrite an existing non-empty field without asking.

---

## Exception handling

- **Agent returns `ERROR:`** — surface the message; offer **retry** / **skip** (where safe) / **abort**.
- **Coder stuck after 3 attempts** — escalate per the build phase.
- **`test-writer` returns `BLOCKED: narrow-interface`** — not a failure and **not a coder attempt**: the production interface is too narrow to test cleanly. Send the `coder` (`mode: fix`) to widen it, re-invoke the test-writer. Auto-mode resolves this itself. **Capped at 2** — a second widening that still doesn't yield a clean test means the *design* is wrong, not the interface; escalate / stop-the-line rather than widening forever.
- **`test-runner` (`red`) returns `RED-SETUP` or `GREEN`** — the test isn't meaningful (it fails for the wrong reason, or it's vacuous). Back to the `test-writer`, **capped at 2**; a third failure escalates (human) / stops-the-line (auto). Never hand a coder a test that hasn't been seen to fail properly.
- **`test-writer` returns `NOT-REPRODUCIBLE`** on a blocker's regression test — accept it, apply the fix without a test, and record the reason in Zone 2. Do not accept a faked test in its place.

  *(All four retry paths in the micro-loop are capped — see [Bounds](#bounds--every-loop-in-this-cycle-is-capped). An uncapped retry is a hang, and auto-mode has no human to notice one.)*
- **New test failures** — block per the baseline section.
- **Rebase/merge conflict** — surface, stop, ask the user to resolve or `/devloop:abort`.
- **GitHub MCP failure** — report; retry once on the user's go-ahead, otherwise note it and continue where the step is non-critical (e.g. an optional label), or exit where it is critical (PR creation, merge).
- **Crash mid-run** — leaves the lock and state file. The next invocation's stale-PID check clears the lock; the recorded `phase` resumes the work.
- **Auto-mode blocker** — where human-mode would escalate to the user (coder stuck after 3 attempts, unfixable `new` failures, a design still `needs-work` after one iteration, a rebase/merge conflict, an agent `ERROR:`, a manual-workflow issue), auto-mode does not ask: it appends the blocker to Zone 2 + `## Log`, releases the lock, and **exits** with the issue left in-progress. A later `run [ISSUE]` resumes from the recorded phase — and **invoked without `--auto` it resumes in human mode** (the sanctioned autonomy downgrade, S6). That is the intended exit from every blocker on this list: each one stopped precisely because it needs a judgment auto-mode isn't entitled to make, so a resume that stayed auto would re-take the same exit forever. Re-running with `--auto` keeps it auto and re-blocks — correct, and occasionally what you want (a transient conflict resolved out-of-band), but it is never the way to *answer* the blocker. See [Autonomy](#autonomy-and-delivery) for the full boundary list.
