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

**Rung — how heavy the phases run.** Orthogonal to the phase set, the **planner** returns a **rung** that sizes the ceremony to the task. The choice turns on one question — *does the change add/alter behavior, and if not, what proves it safe?* — and there are three:
- **`STANDARD`** — new or changed behavior. The full path (TDD micro-loop per task, two-pass review); its proof is a **new test, red-verified**.
- **`EXPRESS`** — no new behavior, safe because *nothing live depends on the touched code* (dead-code removal, constant bump, isolated copy tweak). Proof: a **triviality grep**.
- **`REFACTOR`** — no new behavior, but the code *is* used and you're restructuring it (extract/inline, rename across call sites, dedup, move a module). Proof: **coverage** — the existing suite exercises the behavior and must stay green across the change.

`EXPRESS` and `REFACTOR` share one [collapsed path](#the-collapsed-path-express-and-refactor) (collapse the test-authoring front half, keep the back half; single-pass review); they differ only in that proof. **No rung flexes verification** — the regression/fitness **back half runs at every rung** ([the back-half rule](#the-back-half-rule--every-rung)), and `validate`/reachability still runs (for the collapsed rungs it is the *primary* evidence). run never picks the rung itself — the planner does, from context, exactly as it decides `NEEDS-DESIGN`; a mis-called `EXPRESS` **auto-bumps to `STANDARD`** the moment its triviality proof fails. The confirmed rung is persisted (`rung:`), so it governs on resume.

**Context is sized on demand, not fixed.** The `context` agent self-calibrates retrieval depth to the issue and biases light; if the planner finds Zone 1 too thin it raises `NEEDS-CONTEXT`, and run deepens exactly that gap (bounded). run does not assess how much context an issue needs any more than it assesses complexity — the specialists signal, run reacts.

**Resume.** On every invocation, run **Startup** first. Startup either starts fresh from the workflow's entry phase, or — if a state file exists — jumps directly to the recorded phase and continues. **Never re-run a completed phase on resume.** When jumping, go straight to that phase's section.

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

**Set at invocation, never inferred.** `$AUTONOMY` is `auto` when `--auto` is in `$ARGUMENTS`, else `human`; `$DELIVERY` is `pr` when `--pr` is present, else `direct`. Persist both as `autonomy:` and `delivery:` in the state file (S6). On resume the state file governs — a run keeps the character it started with and never silently switches; flags on a resume that differ from the recorded modes do not switch them (warn if they differ). (The `## Pending gate` block is a human-mode device for re-presenting a panel; auto-mode resolves gates in place and does not rely on it.)

**Decision policy (auto-mode).** At each gate, take the choice the human-mode panel would *recommend* — the agents' own verdict — and record why:
- accept the agent's structured output as produced (the planner's plan, **rung**, and phase set, a `sound` design, the reviewer's upheld findings). **Accept the planner's rung; never downgrade it on run's own initiative** — the planner chose `EXPRESS`/`STANDARD` from context, and auto-mode has no human to catch an over-eager downgrade. A rung only ever moves *up*: the `EXPRESS`→`STANDARD` **auto-bump** (triviality proof fails, or an EXPRESS blocker/`new` failure surfaces) is automatic and **not** a stop — it converts to full ceremony and continues.
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
| `.context/sprints/work/issue-N/plan.md` | issue | `planner` | `Rung:` (EXPRESS/STANDARD) + ordered tasks + acceptance per task; EXPRESS carries a `Triviality proof` section |
| `.context/sprints/work/issue-N/test-plan.md` | issue | `planner` | unit scenarios per task + e2e scenarios (STANDARD only; EXPRESS writes none) |
| `.context/sprints/work/issue-N/spike/` | issue | `coder` (spike mode) | throwaway proof-of-concept; reference only, safe to delete |
| `.context/sprints/work/issue-N/logs/` | issue | `coder`, `test-runner` | raw test/check output — the evidence behind a Zone 2 entry. Never loaded by default; cited under **Artifacts** and opened on demand |
| `.context/sprints/work/issue-N/run-state-final.md` | issue | **run** (at cleanup) | the archived state file — its `## Log`, plan, and tasks kept for post-mortem after the issue is done |
| `.context/sprints/state/issue-N.md` | issue | **run only** | phase, position, branch, pr, plan, tasks, log — **while in progress**; archived to `work/` at cleanup |
| `.context/sprints/state/.lock` | global | **run** + `pr-fix` | `holder` (`run`/`pr-fix`), issue or PR number, PID, start time |
| `.context/devloop-profile.md` | project | roadmap; **run write-back** | build/test commands + test layout |
| `.context/devloop-baseline.md` | project | **run** (on user decision) | accepted-failing tests |

`work/` and `state/` are run's working area for one issue; `profile`, `baseline`, `master-plan`, and `sprint-N` are shared project records. Whether any of these are version-controlled is the user's choice — run neither assumes nor enforces a gitignore policy.

### context.md Zone 2 — the shared timeline

Zone 2 is an **append-only timeline**: agents and gates add entries in execution order; nobody edits or deletes a prior entry. It carries decisions — not just artifacts — between phases. Each entry stands alone (a later reader understands it without re-deriving) and follows the format embedded in the file's Zone 2 header (`### [time] · [author] · [ref]` with `Did` / `Decisions` / `For next` / `Artifacts`).

Agents are not limited to the standard files — a step may create its own supplementary artifact (a generated schema, a scratch analysis, a data sample). When it does, it lists the path under **Artifacts** with a one-line "load this if…" hint, so a later agent (or run) chooses whether to read it instead of everyone loading everything.

### Detection provenance — `Caught by:` and the log trail

**Record how each defect was found, not just that it was fixed.** Any Zone 2 entry that records a defect carries a **`Caught by:`** field naming the gate that detected it: `test-red` · `typecheck` · `lint` · `reviewer` · `critique` · `validation` · `spike` · `demo` · `human`. (`demo` and `human` are written by `/devloop:review` in the outer loop, not by run — `demo` when running the change through the real entry point surfaces a defect every inner-loop gate passed.) Without it the history is unreconstructable — `/devloop:review` cannot tell a human whether a bug was caught by a failing test or by someone reading the code, and neither can you tell, across many issues, **which gates are actually load-bearing and which never fire**. That is the only way to find out that (say) the test suite has never once caught a real bug while the critique catches most of them.

**Evidence goes in a log file, not in Zone 2.** Zone 2 is loaded by every downstream agent — the planner, the coder, the reviewer all read `context.md`. Paste a stack trace into it and every future agent on this issue pays that context cost to serve one reader who shows up at the end. So split it:

| Tier | Where | Content |
|---|---|---|
| **Signal** | Zone 2 entry | failing test id, the one-line error, `Caught by:`, and the log path under **Artifacts** |
| **Evidence** | `work/issue-N/logs/<timestamp>-<what>.log` | the raw output — full failure, stack, assertion diff |

Pass `$LOG_DIR` = `.context/sprints/work/issue-N/logs/` to the `coder` and the `test-runner`; each writes its own output there and returns the path, which run (or the agent itself) cites under **Artifacts**. Nobody loads a log by default; `review` opens one on demand when the human says "show me the failure."

**Who appends:**
- `designer`, `planner`, `test-writer`, `coder`, `reviewer` — one entry each when they finish (per their contracts).
- **run** — one entry at each gate decision (a human's in human-mode, run's own reasoned decision in **auto**-mode, attributed to `run (auto)`) and whenever it changes shared state: a plan reshaped/accepted at gate-plan, findings accepted/declined at gate-review, manual ACs confirmed or flagged at gate-validation, a failure baselined, or an auto-mode blocker that halts the run. At gate-review run sets **`Caught by:`** per finding — `reviewer` for pass 1, `critique` for a finding pass 1 missed.
- `context` owns Zone 1 and leaves Zone 2 empty (with the legend). `test-runner` **never writes to Zone 2** — it returns its buckets (and its log path) to run, which records any baselining and cites the log. Writing its own run log to `$LOG_DIR` is not an exception to that: it is capturing evidence, not mutating state, and its `disallowedTools` still bar it from touching code or tests.

**Timestamps must be script-derived — never the session clock.** Before invoking an appending agent, and before writing your own gate entry, derive a fresh timestamp and use it as `$NOW`:

```
node -e "console.log(new Date().toISOString())"
```

Node is always available (the bundled milestone MCP requires it); the trailing `Z` is the timezone designator. Pass `$NOW` into the agent invocation — the agent uses it verbatim. **Never** use a date from the prompt or session context; it may be stale.

### State file schema

```markdown
# Issue N — run state

issue: N
workflow: feature | bugfix | design | scaffold | manual
rung: express | standard | refactor | -   # set at gate-plan from the planner's plan.md; '-' until then / for non-code workflows
autonomy: human | auto           # set at S6 from $AUTONOMY
delivery: direct | pr            # set at S6 from $DELIVERY; both govern on resume
phase: <phase name>
phase_step: -        # multi-pass phases (design/review/validate) only; '-' otherwise
task_index: -        # build-loop position, 0-based; '-' otherwise
branch: <branch>     # '-' until created
base: <base branch>
pr: -                # set once PR created
merge-commit: -      # the squash/merge SHA on $base; set at merge
history-ref: -       # refs/devloop/issue-N — the branch as built, archived at merge (local only)

## Plan (confirmed at gate-plan)
rung:   express | standard | refactor   # STANDARD: full TDD; EXPRESS/REFACTOR: collapsed front half, back-half kept
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

Append a `## Log` line at every phase boundary and human decision. Update `phase` / `phase_step` / `task_index` **before** invoking the agents for that step, so a crash resumes correctly.

---

## Startup

Run this section on every invocation, in order.

### S1 — Resolve the active sprint

Determine the active sprint:
- Read `.context/sprints/master-plan.md`; find the entry with `- **Status:** active`. Use its sprint number and `Sprint file:`.
- If none is active, fall back to the highest `.context/sprints/sprint-N.md` on disk.

If no sprint file can be found:

> No active sprint found — run `/devloop:plan` first.

Stop. Otherwise read the sprint file and extract `$SPRINT_N`, `$SPRINT_FILE`, `$SPRINT_GOAL`, `$REPO`, and the ordered issue checklist.

### S2 — Concurrency guard

Read `.context/sprints/state/.lock` if it exists. Determine PID liveness with `kill -0 <pid> 2>/dev/null` (exit 0 = alive).

| Lock | Action |
|---|---|
| live PID, `holder: run` | `⚙ run is already in progress for #M (PID alive). Finish or /devloop:abort it first.` → **exit**. (A live process owns the run regardless of `$ISSUE`.) |
| live PID, `holder: pr-fix` | `⚙ pr-fix is working the tree on PR #[pr] (PID alive). Let it finish before starting a run.` → **exit**. |
| dead PID | `⚠ Found a stale lock from a previous session — clearing it.` → delete `.lock`, proceed. (Read `holder` if present; a missing `holder` predates the field — treat as `run`.) |
| absent | proceed |

### S3 — Read project profile and baseline

Read `.context/devloop-profile.md`. If it does not exist:

> `.context/devloop-profile.md` not found — run `/devloop:roadmap` to set up build/test commands first, or I'll have to ask for each command as I need it. Continue anyway? (y/n)

On **n**, exit. On **y**, proceed and ask for commands inline when a phase needs one (writing each answer back to the profile).

Collect the profile's **check commands** (`build`, `unit-test`, `typecheck`, `lint`, and `e2e-test` — whichever the profile lists) as **`$CHECKS`**: the checks run executes locally as the back-half, at **every rung**. run never hardcodes this set — it is exactly what the profile declares. A project whose CI owns a heavy check (a full e2e matrix, integration, a security scan) simply does not list it here; in `--pr` mode the merge is still gated on that CI by branch protection (see the [merge phase](#delivery-pr)), and `direct` mode has no CI, so the profile's checks are the whole gate.

Read `.context/devloop-baseline.md` if it exists (the accepted-failing allowlist). Treat absent as empty. Collect its test ids as **`$ACCEPTED`** — these are already-failing, already-accepted checks, and **every agent that runs the suite must be told about them**, not just the `test-runner`. A suite command exits non-zero on an accepted failure exactly as it does on a real one, so a `coder` that has not been given `$ACCEPTED` can never reach green in a project with a baseline: it would burn all three attempts chasing a failure that is not its own, on every task. Pass `$ACCEPTED` to the `coder` alongside `$CHECKS`.

### S4 — Resolve the target issue and entry point

| Invocation | State file `issue-N.md` | Action |
|---|---|---|
| `run N` | exists | Check GitHub: if the issue is already closed (its PR merged, or a direct merge landed) → set entry = **merge** (cleanup only). Else set entry = the recorded `phase` (resume). |
| `run N` | none | Entry = the workflow entry phase (fresh). Warn if N is not in `$SPRINT_FILE`, but allow. |
| `run` (no arg) | exactly one in-progress | issue closed → entry = **merge** (cleanup); else entry = recorded `phase` (resume). |
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

A non-structural `type:chore` starts as **feature** here, but may turn out to have no code to build (configure DNS, obtain a sign-off, a manual QA pass). run does not decide this at startup — the **planner** does, returning `MANUAL` from the plan phase, which routes the issue to the **manual** workflow (a single confirmation gate, no branch/tests/PR). The user can also force it at gate-plan ("this is a manual task").

Some issues don't fit a single archetype — "run the suite and review existing code," a spike/investigation, a docs-only chore, or a task that mixes design and build. In those cases pick the nearest template and let the planner propose a **custom phase set** drawn from the named phases; the user shapes the final list at gate-plan. The archetype only decides where to *start*; the actual phases run executes are always the ones confirmed there. (On resume, the confirmed phase list in the state file governs — S5 does not re-run.)

### S6 — Acquire lock and dispatch

Write `.context/sprints/state/.lock` with `holder: run`, `issue: $ISSUE`, the current PID (`pid:`), and an ISO `start:` time. The `holder` field distinguishes this from a `pr-fix` lock (`holder: pr-fix`, `pr: N`) on the same file — every reader keys mutual exclusion off the PID, and uses `holder` only to label who holds the tree. If no state file exists yet, create `state/issue-N.md` with the schema above (`phase: context`, branch `-`, `autonomy: $AUTONOMY`, `delivery: $DELIVERY`). When **resuming** an existing state file, `$AUTONOMY` and `$DELIVERY` are read from its `autonomy:`/`delivery:` lines — the started modes govern; flags on a resume that differ from the recorded modes do not switch them (warn if they differ).

Announce and dispatch:

> **▶ run — Sprint [N] · #[ISSUE] [title] · workflow: [workflow] · mode: [human | auto] · delivery: [direct | pr]**
> [Starting fresh from context. | Resuming from phase "[phase]".]
> [auto only:] Human-on-the-loop — no gates will stop; every decision is logged to context.md for your review. I'll halt only if I hit something I can't decide safely.

Jump to the entry phase. The lock is released on clean exit, at `pending-review`, and at `merge`.

---

## Phase: context

**Active in:** all workflows.

If resuming and `context.md` already exists:

> Context for #[ISSUE] was built [relative time] ago ([build timestamp]). Refresh it from scratch? (y/n)

Compute the relative time from scripts, not the session clock: read the build timestamp recorded in the state log when context was last built, take the current time with `node -e "console.log(new Date().toISOString())"`, and derive the delta from those two values. If no build timestamp was recorded, show the absolute timestamp only.

On **n**, keep the existing file and continue. On **y** (or on a fresh start), invoke `context`.

Invoke **`context`**, passing: `$ISSUE`, `$REPO`, `$SPRINT_GOAL`, the work dir `.context/sprints/work/issue-N/`, a one-line profile summary, and `$NOW` (script-derived) for its Zone 2 legend. For **scaffold**, request the `light` variant (issue + workspace map only); otherwise `full`, in which the agent **self-calibrates depth** (`minimal`/`standard`/`deep`) to the issue and biases light — run does **not** dictate the depth, exactly as it does not assess complexity for a design decision. It writes `context.md` Zone 1 and returns the `TIER` it chose. Record the build time (`$NOW`) **and the tier** in the state log so a later resume can compute the relative age and the retro can see whether the default is calibrated.

**A light default is safe because context is reachable on demand.** If a later agent finds Zone 1 too thin, it raises `NEEDS-CONTEXT` (the planner does today; see [plan](#phase-plan)), and run re-invokes `context` in `deepen` mode to fill exactly that gap — appending to Zone 1, not rebuilding. This is the escape hatch; it is what lets the agent bias light without starving the planner.

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

---

## Phase: plan

**Active in:** feature, bugfix.

Invoke **`planner`**, passing `context.md`, the issue's acceptance criteria and Definition of Done, the profile flags (`$HAS_UNIT_TESTS`, `$HAS_E2E`), `$NOW`, and the `design.md` path **if a design phase ran**. It writes `plan.md` (ordered tasks + per-task acceptance, headed by a **`Rung:`** — `EXPRESS` or `STANDARD`) and, for `STANDARD`, `test-plan.md` (unit scenarios per task, e2e per flow; bugfix is root-cause first). For `EXPRESS` it writes a `Triviality proof` section instead of a test-plan. If a design guide was provided, the tasks realise that approved approach.

**Context detour.** Zone 1 is sized light by the `context` agent. If the planner finds it too thin to plan responsibly, it returns `NEEDS-CONTEXT: [the specific fact it needs]` instead of a plan. run reacts by re-invoking **`context`** in `deepen` mode (`$MODE: deepen`, `$GAP:` the requested fact, `$NOW`) — which appends the fact to Zone 1 — then re-invokes the planner. **Capped at 2 deepens** (see [Bounds](#bounds--every-loop-in-this-cycle-is-capped)): if the planner still can't plan after two, the *issue* is underspecified, not the context — re-invoke it one last time with `$CONTEXT_FINAL: true` so it plans best-effort and records the residual uncertainty (human mode surfaces that at gate-plan; auto-mode proceeds and logs it, or stops-the-line if it instead escalates to `NEEDS-DESIGN`). A `deepen` that returns `unresolved` (the fact doesn't exist) counts against the cap and is itself signal — the planner may be assuming something absent.

**Design detour.** The decision to design is the **planner's**, not run's: if it judges it cannot responsibly break the work into tasks without an architecture/approach decision first, it returns `NEEDS-DESIGN: [why]` instead of a plan. run does not assess this itself — it simply reacts to the signal: activate the **design** phase above (draft → [spike] → critique → gate-design), and after approval return here and re-invoke the planner with the approved `design.md`. If the user declines at gate-design ("skip design"), run re-invokes with `$DESIGN_DECLINED: true` — the planner then plans best-effort and must not return `NEEDS-DESIGN` again (no loop).

**Manual detour.** Likewise the planner decides an issue has no code to build: it returns `MANUAL: [why]` instead of a plan. run reacts by switching the workflow to **manual** (`workflow: manual` in the state file), recording `phase: gate-manual`, and jumping there — it does **not** write a plan, create a branch, or run any build/test/review/PR phase. (This bypasses gate-plan entirely; the only gate for a manual issue is gate-manual.) Continue to [gate-manual](#gate-gate-manual).

Record `phase: gate-plan`. Continue.

---

## Gate: gate-plan

**Active in:** feature, bugfix. *(Human gate.)*

### Build the execution plan

run owns the phase list. Start from the workflow default (the table in [How this skill works](#how-this-skill-works)), then adjust to the planner's **rung** (`plan.md`'s `Rung:` line) and what it produced:

- **`STANDARD`** — the full path: `build` (TDD loop per task) → e2e → review → validate → deliver.
- **`EXPRESS`** / **`REFACTOR`** — the [collapsed path](#the-collapsed-path-express-and-refactor): the `build` phase applies the change **without** the test-writer/red front half, running the rung's proof first (**triviality** grep for EXPRESS, **coverage** confirmation for REFACTOR) and the back-half suite; `review` is a **single reviewer pass** (no fresh-instance critique); `validate`/reachability still runs. e2e is dropped unless the profile+plan call for it.

Then adjust for what the planner produced:
- `test-plan.md` has e2e scenarios **and** the profile has an `e2e-test` command → include **e2e**. Otherwise drop it. (`EXPRESS`/`REFACTOR` write no `test-plan.md`.)
- DoD includes "Code reviewed" → include **review** (single-pass for `EXPRESS`/`REFACTOR`, two-pass for `STANDARD`). The issue has acceptance criteria → include **validate**.
- Count build tasks from `plan.md`.

When the issue doesn't match its archetype, compose the phase set directly from the named phases to fit the real work — e.g. a "test + review existing code" task is `build`-less (review + validate only); an investigation/spike is `context → plan → gate-plan` then done. The phase list can be any sensible subset/order of the named phases — that is what makes the workflow dynamic while keeping every phase predictable. (The design phase is not composed here — it sits *upstream* of this gate and is reached via the planner's `NEEDS-DESIGN` detour or the design workflow.)

Then compute which **gates** will fire: `gate-plan` (now), `gate-review` (if review is active), `gate-validation` (if any acceptance criterion is manual / not test-backed), and the **delivery gate** — `gate-deliver` if `delivery: direct`, `gate-pr` if `delivery: pr` (always, for code workflows).

### Present

> **Execution plan for #[ISSUE] — [title]  ([workflow] · rung: [EXPRESS | STANDARD | REFACTOR])**
>
> [EXPRESS:] Trivial change — [why]. No new test; verified by the triviality proof below + the full check suite.
> [REFACTOR:] Behavior-preserving restructure — [why]. No new test; the existing suite (coverage below) must stay green.
>
> | Stage | What |
> |---|---|
> | Code | [STANDARD: TDD loop × [N] tasks (test → code per task)] [EXPRESS/REFACTOR: apply [N] change(s), no test-first] |
> | Proof | [EXPRESS: what I'll grep to confirm nothing depends on it] [REFACTOR: the existing tests that guard the behavior — coverage adequate/THIN] |
> | E2E | [scenario list] |  ← omit row if e2e not active
> | Review | [STANDARD: diff review + critique] [EXPRESS/REFACTOR: single review pass] |  ← omit if not active
> | Validate | [K] acceptance criteria ([M] need manual check) |
> | Deliver | [branch] → [base] · [merge locally (direct) \| open PR (pr)] |
>
> Gates I'll stop at:
> ① now — approve this plan [STANDARD: + test strategy]
> ② after review — approve findings before fixes  ← list only active gates
> ③ after validate — verify [M] ACs manually
> ④ [direct: before merge — confirm merging to [base] \| pr: before PR — approve PR content]
>
> Approve, or reshape (e.g. "skip e2e", "skip review", "make this STANDARD", "this is a refactor", "open a PR"):

Apply any reshaping the user asks for (drop/add a stage, switch workflow, **change the rung**). The user has final say on the rung too: **`STANDARD`→`EXPRESS`** (downgrade — "this is trivial, don't bother with a test") is allowed and honored, logged with the user as its author; **`EXPRESS`→`STANDARD`** (upgrade) re-invokes the planner to produce a `STANDARD` plan (`test-plan.md` and all). Re-present until approved. The user reshaping the plan is the flexibility valve — honor it.

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

> ⏸ #[ISSUE] is a manual task — auto-mode can't complete it. Run `/devloop:run [ISSUE]` (human mode) to confirm the criteria.

---

## The TDD micro-loop

The four-step cycle that turns one unit of intent into committed, verified code. **run uses it in exactly two places** — once per **task** in a `STANDARD` build phase, and once per **blocker** at gate-review — and it is identical in both. (An `EXPRESS` or `REFACTOR` build phase does not use this cycle: it has no failing test to author, so it runs [the collapsed path](#the-collapsed-path-express-and-refactor) — the collapsed front half plus the same back half — instead.) Only the **seed** differs:

| Caller | `$SEED` | `test-writer` mode | `coder` mode |
|---|---|---|---|
| build phase (per task) | the task's scenarios in `test-plan.md` | `unit` | `implement` |
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

### The back-half rule — every rung

Steps 3–4 are the **back-half**: the coder runs the profile's checks `$CHECKS` (build/typecheck/unit/lint — its commit gate), and the `test-runner` independently re-runs the *tests* and classifies them against the baseline. **This back-half runs at every rung.** The rung (`EXPRESS`/`STANDARD`) flexes only the *front half* — steps 1–2, authoring a failing test and verifying it red. `EXPRESS` skips the front half because a trivial mechanical change has no new behavior worth pinning; it never skips the back half, because the *existing* suite and fitness functions can still break. `$CHECKS` is exactly what the profile declares (S3) — a rung never drops one of them. So "green to land" means the same thing at both rungs: **the profile's checks pass with no `new` failures**; only the question "was a new test authored for this change?" differs.

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

For the task at `task_index`: run the micro-loop with `$SEED` = the task (test-writer `unit`, coder `implement`). Then mark the task `[x]`, increment `task_index`, and append a log line.

**Escalation.** If `coder` cannot make the tests pass after **3 attempts** on the same task, stop the loop:

> Stuck on task [i] "[task]" after 3 attempts. Last failure:
> ```
> [output]
> ```
> How do you want to proceed? **retry** / **edit the plan** / **accept as known-failing** (needs a tracking issue) / **abort** (`/devloop:abort`)

When all tasks are `[x]`, record `phase:` = next active phase (`e2e` if active, else `review`). Continue.

### The collapsed path (EXPRESS and REFACTOR)

Both rungs skip the test-authoring **front half** of the micro-loop (no test-writer, no red-verify) and keep the **back half** in full ([the back-half rule](#the-back-half-rule--every-rung)). They share one execution path; they differ only in the **proof** that licenses skipping the front half — each has exactly one, and it runs *first*:

| Rung | The change | Proof (step 1) | If the proof does not hold |
|---|---|---|---|
| **EXPRESS** | trivial; nothing live depends on the touched code | **triviality** — grep the `## Triviality proof` targets: callers of a removed symbol → zero, readers of a changed constant → none coupled, the named blast radius → empty | the change isn't trivial → **auto-bump to STANDARD** |
| **REFACTOR** | behavior-preserving restructuring of code that *is* used | **coverage** — the existing suite exercises the behavior being restructured: confirm the tests the planner named in `## Coverage` pass on the **current** code (the green the refactor must preserve) | coverage is `THIN`/absent → can't refactor blind → **surface** (human: add coverage first / accept the risk; auto: **stop-the-line**) |

Per task in `plan.md`:

1. **Run the rung's proof** (table above), capturing output to `$LOG_DIR`. On EXPRESS the proof failing means the rung was mis-called → **auto-bump to `STANDARD`** (re-invoke the `planner` for a `STANDARD` plan, set `rung: standard`, log to Zone 2 `Caught by: validation`, restart this phase on the STANDARD path). The bump is a **one-way ratchet** — a rung only ever moves up — so no cap. On REFACTOR, `THIN` coverage is not a bump but a **surface/stop** as in the table (you don't fix under-coverage by adding ceremony to the refactor; you add coverage first).
2. **Apply the change.** Invoke **`coder`** (`mode: express` — apply the change; there is no authored test to turn green, so success = the profile's checks pass) with `$SEED` = the task, `plan.md`, `context.md`, `$NOW`, `$LOG_DIR`, **`$CHECKS`**, `$ABSENT`, and **`$ACCEPTED`**. It commits only when all `$CHECKS` pass. (The `MISSING: <check>` round-trip applies here too.)
3. **Verify — the verdict.** Invoke **`test-runner`** (`mode: unit`) with the profile's test command (`$UNIT_CMD`), the baseline, `$LOG_DIR`, `$NOW`. Three buckets; `new` failures block, and what a `new` failure *means* is the crux of each rung:
   - **EXPRESS** — a new failure means the change touched real behavior after all → **auto-bump to STANDARD** (there *is* something to fix and guard).
   - **REFACTOR** — a new failure means the restructuring **changed behavior**, which is the one thing it must not do → the `coder` fixes it (still REFACTOR — the fix is to restore the behavior, not to add a feature); unfixable after 3 attempts → escalate / stop-the-line.

   Then mark the task `[x]`, increment `task_index`, log.

When all tasks are `[x]`, record `phase:` = next active phase (`review` — single-pass for both collapsed rungs — else `validate`). Continue.

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

**Rung shapes the review depth.** `STANDARD` runs **two passes** (review + fresh-instance critique — steps 1–2). `EXPRESS` and `REFACTOR` run a **single pass** (step 1 only): the change carries no new behavior and its proof already ran (triviality / coverage), so one set of fresh eyes is proportionate — but it is never *zero* eyes for a code change. Skip step 2 for both; go straight from step 1 to the gate with only the pass-1 findings. (If pass 1 on an `EXPRESS` change surfaces a **blocker**, that contradicts the triviality claim → auto-bump to `STANDARD` and re-review with the critique pass. A blocker on a `REFACTOR` change is a real finding to fix in place — the refactor is non-trivial by definition, so it stays `REFACTOR`.)

1. **Review** (`phase_step: reviewed`). Invoke **`reviewer`** (`mode: review`) on the diff. It returns findings across four dimensions — correctness bugs, DRY violations, reuse/simplification, consistency — each classified `blocker` or `refactor`. **If a `design.md` exists** for this issue, pass its path: the reviewer also checks the implementation conforms to the approved design (interfaces, approach, module boundaries), so the design actually governs the code rather than just preceding it.

2. **Critique** (`phase_step: critiqued`) — *STANDARD only; skipped for EXPRESS*. Invoke **`reviewer`** again as a **fresh instance** in `mode: critique`, passing the findings from pass 1. Because it shares no memory with pass 1, it is an independent second opinion: for each finding it returns `uphold` or `drop` with one-line reasoning. run does this reasoning *nowhere itself* — it just collects the two structured returns.

   It may also return **`NEW`** findings — bugs pass 1 missed. This channel is restricted at the agent to **blocker-class correctness only** (never simplicity, style, or nits; see the agent's contract for why an unrestricted channel would never converge). The fresh instance is the only second look this diff gets before it merges, and it would be perverse to have it spot a real bug with nowhere to put it — so `new` findings are treated exactly like upheld blockers from here on.

3. **gate-review** (`phase_step: gated`). Merge the two passes and present grouped:

   > **Review — #[ISSUE]**
   >
   > **Upheld ([n])** — both passes agree; will be addressed
   > - [blocker|refactor] [file:line] [finding]
   >
   > **New from critique ([n])** ⚠ — the second pass caught these; pass 1 missed them
   > - [blocker] [file:line] [finding]
   >
   > **Dropped ([n])** — critique judged these not worth acting on: [reasoning]
   > **Disputed ([n])** ⚠ — review flagged, critique disagreed (or vice-versa); your call
   >
   > Override any verdict, or confirm to proceed:

   "Disputed" = the two passes disagree; surface these for the user, who has final say on everything. Omit any bucket with no findings.

4. **Apply.** There is no separate refactor agent — fixing is the coder's job in `fix` mode. But the two classes of finding are applied differently, because they mean different things:

   **Blockers** (upheld, new-from-critique, or disputed-and-confirmed) **ship with a regression test.** A blocker is by definition a bug the **entire suite already ran over and did not catch** — that is why a reviewer had to find it by reading code. So re-running that same suite after a bare patch proves nothing: it was green before the fix and it will be green after, whether or not the fix works. So each blocker goes through [the TDD micro-loop](#the-tdd-micro-loop) with `$SEED` = the finding (test-writer `regression`, coder `fix`) — same four steps and same bounds as a build task. Now the fix is proven to work, and the bug cannot come back unnoticed.

   **Not every blocker can be pinned by a test** — a divergence from the approved design, a bug whose trigger depends on timing you cannot force deterministically, a finding about code with no observable behaviour. The test-writer returns `NOT-REPRODUCIBLE: [why]` rather than faking a test that passes for the wrong reason (which would be worse than none, because it would be trusted). Skip steps 1–2, apply the fix, and **record the reason in Zone 2** — a blocker shipping untested is exactly what a human should see at review.

   **Refactors** change no behaviour, so they get **no new test** — they skip steps 1–2 of the micro-loop entirely: `coder` (`mode: fix`) applies each accepted one, `test-runner` (`unit`) verifies nothing broke. In human mode each is offered to the user first. If any refactor was applied and e2e is active, re-run `test-runner` (`full`) to catch regressions.

**Auto-mode.** No panel. Resolve each finding by verdict and log every call: **upheld** (both passes agree) blockers and refactors are applied; **new from critique** are applied (they are blocker-class by construction); **disputed** (the passes disagree) blockers are applied (safe = fix the possible bug), disputed refactors are skipped (safe = don't churn working code); **dropped** findings are left. Apply exactly as in step 4 — blockers through the mini-TDD loop (regression test first, red-verified), refactors bare. If a fix can't be made to pass, or a regression test can't be made to go red in two tries, that routes through the build-phase escalation → **stop-the-line**. The Zone 2 entry below records each per-finding decision and its reasoning, attributed to `run (auto)`, including any blocker that shipped `NOT-REPRODUCIBLE` and why.

Append a Zone 2 entry (`$NOW`) recording the gate outcome — which findings the user (or, in auto-mode, run) upheld, dropped, or overrode — so validation sees the decision. Set **`Caught by:`** per applied finding (`reviewer` for pass 1, `critique` for one pass 1 missed), and cite the regression tests written and the `test-runner` logs under **Artifacts**. This is what lets `/devloop:review` later tell a human *how* a bug was found rather than guessing — and, across issues, which gates are earning their keep.

Record `phase: validate`. Continue.

---

## Phase: validate

**Active in:** feature, bugfix. *(Human gate: gate-validation, if manual ACs exist — or if any AC failed its reachability trace, which is an unmet AC and always gets a human in human mode.)*

Cross-check the issue's acceptance criteria and Definition of Done against what was delivered. `phase_step`: `auto-checked` → `gated`.

- **Automated ACs / DoD** (test-backed): an AC is satisfied when a passing test covers it **and** the behavior it asserts is **reachable from a production entry point**. Both halves are required — see [Reachability](#reachability-a-green-test-is-not-a-satisfied-ac) below. "PR merged to main" cannot be checked yet — leave it.
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
  >
  > Confirm each is met (y / list the ones that fail):

### Reachability: a green test is not a satisfied AC

**"A test covering this AC passes" and "the system does this" are different claims, and this phase is the only gate positioned to notice the difference.** A unit test verifies a symbol against *its own contract*; it is structurally incapable of noticing the symbol has no callers. Typecheck and lint accept an exported symbol nobody imports. The `reviewer` sees a module and its tests land together, freshly written and green, and it *looks complete*. Nothing in the diff announces "and nothing calls this." So the artifact ships — implemented, tested, documented, green, and **unreachable** (`docs/field-reports/2026-07-13-green-but-unreachable.md`: a tier resolver whose guardrail was tested, passing, and bypassed by the real adapter; every request billed straight past it).

So for **each automated AC**, do not ask *"is this test-backed?"* — ask **"what production call path exercises this?"** and answer it concretely:

1. Identify the symbol(s) the AC rests on (the function, guard, validator, schema, route, or resolver the tests assert against).
2. `grep -rn <symbol>` across production sources — the **non-test** tree.
3. **Name the path**, composition root inward: `AC1 → src/index.ts → createGateway() → llm/complete.ts:41 → resolveTier()`. A path must terminate at a real entry point (CLI command, HTTP route, exported package API, scheduled job, composition root) — not at another untested, uncalled module.

Two failure shapes, both **unmet ACs**:

- **Nothing calls it.** The symbol's only references are its own definition and its own test file. The AC is satisfied *as a library function* and unsatisfied *as a behavior of the running system*.
- **Something calls it, but nothing real feeds it.** The symbol is imported, but the only inputs it ever validates or resolves are objects the tests construct. Ask what feeds it in production and read *that* code — a schema green against hand-built fixtures can be incapable of accepting one real line from the actual producer.

The cost is one grep per AC. **Never tick an AC because its test is green when this trace comes up empty** — that tick is precisely how a green, unreachable module sails into `main` with a checkmark beside it.

If any AC or required DoD item is unmet — including any that **failed the reachability trace**:

> [k] of [total] criteria are unverified: [list]. Create the PR anyway? (y/n)

**Block with override** — proceed only on explicit `y`. On `n`, return to the relevant phase (build for a failed behavior or a missing production call path, e2e for a failed flow). Re-entering an earlier phase re-runs the phases after it that are affected by the change (e.g. a build fix re-runs review and validate); unaffected completed phases are not redone.

**Auto-mode.** The **reachability trace runs exactly as above** — it is mechanical, it needs no human, and auto-mode is where it matters most, because nobody is looking at the diff before it merges. An AC whose trace comes up empty is **not** a flag to carry forward: unlike a manual AC that *can't* be automated, this is a **demonstrable defect with a known fix** — the code was never wired in. Route it back to **build** as one scoped wiring task (coder → test-runner → review, as any build fix). Attempt this **once per AC**; if the wiring can't be done without a decision the run isn't entitled to make (which entry point should call this, whether the design intended this path at all), **stop-the-line** — log the blocker with the empty trace and exit, exactly as anywhere else auto-mode would escalate.

For each **manual** AC, best-effort to remove the human dependency: invoke `test-writer` + `test-runner` to write a test that exercises the behavior. If it passes, the AC is genuinely verified — *and it still needs a reachability trace, for the same reason: a test the loop wrote itself is the loop vouching for the loop.* If the new test *fails* (the behavior is actually broken), that is a `new` failure → handle per the baseline (coder fix; unfixable → **stop-the-line**). If the behavior can't be meaningfully automated, mark the AC **unverified**, log it, and carry it forward as a `needs manual verification` flag — into the PR body when `delivery: pr`, or (direct) recorded in Zone 2 for the human to confirm in the outer-loop review — never waive it silently. Auto-mode does **not** stop at gate-validation; unverifiable ACs travel forward as flags for the human to confirm during review.

Append a Zone 2 entry (`$NOW`) recording the validation outcome — which criteria were confirmed (and how — auto-test vs already test-backed), **the traced production call path for each automated AC** (verbatim, e.g. `AC1 → src/index.ts → createGateway() → llm/complete.ts:41 → resolveTier()`), which the user waived on override, and (auto-mode) which were left `needs manual verification`. A trace that came up empty is a defect found here: record it with **`Caught by: validation`**, and cite the grep under **Artifacts**. The traces are not bookkeeping — `/devloop:review` reads them at the outer loop, where today the human has to reconstruct them by hand, which is exactly how both field-report cases were found.

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
>
> Merge to [base] now? (y / edit / open a PR instead)

- **y** → record `phase: merge` and continue to the [merge phase](#phase-merge) (direct variant).
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
2. Tick the issue's checkbox `[x]` in `$SPRINT_FILE`.
3. **Archive the state file, then release the lock.** Move `.context/sprints/state/issue-N.md` → `.context/sprints/work/issue-N/run-state-final.md` (this preserves its `## Log` — the script-timestamped run history — plus the confirmed plan and tasks, for post-mortem reference), then delete `.context/sprints/state/.lock`. Do **not** leave `issue-N.md` in `state/`: a completed issue's file lingering there would read as *in-progress* to a future `run` (Startup S4).
4. Leave `work/issue-N/` in place (useful for reference) — it now also holds `run-state-final.md`.
5. Print the terminal's one-line ✅ report (each terminal supplies its own wording — the delivery variants above supply the merge-path wording), then ask **"Move to the next issue? (y/n)"** — on **y**, return to **Startup S4** as the no-arg case (pick the next unchecked issue); on **n**, exit cleanly. **Auto mode skips this prompt** and exits cleanly after the report — one invocation handles one issue; sprint-level sequencing belongs to `/devloop:sprint`, not to run.

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
- **Auto-mode blocker** — where human-mode would escalate to the user (coder stuck after 3 attempts, unfixable `new` failures, a design still `needs-work` after one iteration, a rebase/merge conflict, an agent `ERROR:`, a manual-workflow issue), auto-mode does not ask: it appends the blocker to Zone 2 + `## Log`, releases the lock, and **exits** with the issue left in-progress. A later `run [ISSUE]` (auto or human) resumes from the recorded phase. See [Autonomy](#autonomy-and-delivery) for the full boundary list.
