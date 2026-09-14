---
description: Execute and resume sprint work for a single issue. Builds context, plans, and drives a TDD loop (or a scaffold/design/manual flow) through to merged code — by default merged into the base locally with no PR; pass `--pr` to deliver through a GitHub PR instead. A resumable phase-based state machine — reads the issue's state file to continue from the last completed phase, pauses at human gates declared up front, and never re-runs a completed phase. Routes the issue to the right workflow from its labels and the user-approved execution plan. Pass `--auto` for human-on-the-loop execution — no gates stop the run; run reasons to the best decision at each one, logs every decision and its reasoning for later review, runs to completion (merging), and halts only when it hits something it can't decide safely; the human then reviews the shipped work in the outer loop (`/devloop:review`). With `--pr`, a human-mode run halts at the open PR for review while an auto run creates the PR and merges it through.
---

You are running **devloop:run**: a resumable, phase-based state machine that takes one issue from raw ticket to merged code (locally by default, or via a GitHub PR with `--pr`).

Parse `$ARGUMENTS`:
- an issue number (`42`, `#42`) → `$ISSUE`; otherwise unset.
- `--auto` (any position) → `$AUTONOMY = auto`, else `human`.
- `--pr` (any position) → `$DELIVERY = pr`, else `direct`.

See [Autonomy and delivery](#autonomy-and-delivery) for what the modes mean.

---

## How this skill works

**Phases.** Each phase has a precondition, invokes agents, writes outputs to files, records its position in the state file, and hands off:

```
startup → context → [design → gate-design] → plan → gate-plan → build → e2e → review → validate → deliver → merge
                                                  ↘ MANUAL → gate-manual → done

deliver = direct (default): gate-deliver              → merge locally, no PR
          pr (--pr):        gate-pr → pending-review   → open a GitHub PR
```

The **workflow** (chosen from labels, confirmed at gate-plan) selects which phases are active. **design** always runs for the design workflow (and ends there), and for feature/bugfix only when the planner returns `NEEDS-DESIGN`. The **manual** workflow is reached when the planner returns `MANUAL` (no code to build): one confirmation gate, no branch, tests, or PR.

**Rung — how heavy the phases run.** The **planner** returns a rung, from two questions: *does the change add/alter behavior — and if not, does it touch any checkable surface?*
- **`STANDARD`** — new or changed behavior. Full TDD micro-loop per task, two-pass review. Proof: a **new test, red-verified**.
- **`EXPRESS`** — no new behavior; safe because *nothing live depends on the touched code* (dead-code removal, constant bump, isolated copy tweak). Proof: a **triviality grep**.
- **`REFACTOR`** — no new behavior, but the code *is* used and is being restructured. Proof: **coverage** — the existing suite exercises it and stays green.
- **`TRIVIAL`** — no new behavior **and no checkable surface**: only whole inert files that feed no `$CHECKS` command (prose docs, `LICENSE`, `CHANGELOG`). No review, validate, or e2e. Proof: an **inertness proof**, re-verified on the real post-edit diff. A comment edit *inside* executable source is `EXPRESS`, not `TRIVIAL` — the file feeds a check.

**No rung skips a check that can see the change** ([the back-half rule](#the-back-half-rule)). run never picks the rung — the planner does. A mis-called rung **auto-bumps up** when its proof fails (`TRIVIAL`→`EXPRESS`, `EXPRESS`→`STANDARD`) — a one-way ratchet. The confirmed rung is persisted (`rung:`) and governs on resume.

**Context is sized on demand.** The `context` agent self-calibrates depth and biases light; if the planner finds Zone 1 too thin it raises `NEEDS-CONTEXT` and run deepens exactly that gap (bounded). The specialists signal; run reacts.

**Resume.** Every invocation runs **Startup** first, which starts fresh or jumps to the recorded phase. **Never re-run a completed phase — or a completed step within one.** Go straight to the step after the one `phase_step` / `task_index` records as done.

**Re-running a reasoning agent is not a retry.** It shares no memory with the first call and returns a *different* result — a second pass-1 review yields a different finding set, and this skill defines no rule for merging two. Treat a re-run as a defect, not a safe default.

**When the recorded position is ambiguous** (a crash between an agent returning and run persisting it leaves `phase_step: -` inside a multi-pass phase), `tail` `context.md` for the **last** `### [ts] · author · ref` header. Appending agents write their entry before returning, so it is a receipt more durable than run's bookkeeping — and it is only trustworthy because Zone 2 is appended with `>>` (an entry landing mid-file would make the last one lie).

| Last Zone 2 entry | Verdict |
|---|---|
| author = this step's agent, in this step's mode, timestamp **≥** the phase's start line in `## Log` | the step ran — record it done, rebuild any gate panel from that entry, continue |
| anything else (older, different author, none) | the step did not run — invoke it |

Never widen this into a scan of Zone 2 or a reconstruction from `git log`, `plan.md`, and the diff. The check fails **toward re-running**: a skipped review ships unreviewed code and nothing downstream notices.

**Agents communicate only through artifacts** — files and their final return message. run is the sole writer of `state/issue-N.md` and the writer of `.lock` for a run. The durable cross-agent decision channel is `context.md` Zone 2.

**Gates are declared up front** — at gate-plan the user sees every gate that will fire. In **auto** mode gates don't stop; run decides and logs.

**Gates are resumable.** A gate panel is built from a non-durable agent return, so **before presenting any gate, write the payload that builds it to the state file's `## Pending gate` block**. On resume *at* a gate, rebuild from that block — never re-run the agent. Clear it once the gate is resolved.

**The green-check gate is "no *new* test failures"**, not zero failures — see [Known-failing baseline](#known-failing-baseline).

---

## Autonomy and delivery

Two orthogonal axes, fixed for the life of the run.

**Autonomy — who decides at gates.**
- **human** (default) — every gate stops and waits. Every gate section below describes this mode.
- **auto** (`--auto`) — human-*on*-the-loop. Same phases, agents, resume, and Zone 2 discipline, but at each gate run applies the decision policy below, acts, and logs the decision *and its reasoning* to Zone 2. An auto run **runs to completion, including the merge**; the human audits afterward (`/devloop:review`). `--auto` is the authorization for every within-scope action, merge included.

**Delivery — how the branch lands.**
- **direct** (default) — rebase-if-behind, merge into the base locally, push, delete the branch; **no PR**. `Closes #[ISSUE]` in the merge commit closes the issue.
- **pr** (`--pr`) — open a GitHub PR. Human mode **halts at the open PR** (`pr-review` / `pr-fix`, then re-run to merge); auto mode creates and **merges it through** (branch protection gates the merge if configured).

| | **direct** (default) | **`--pr`** |
|---|---|---|
| **human** (default) | gates stop; `gate-deliver` → merge locally | gates stop; create PR, **halt** at `pending-review` → re-run to merge |
| **auto** (`--auto`) | run to completion → merge locally | create PR → merge through |

Only **human + pr** halts before merge. `/devloop:sprint` drives plain `run --auto` across the sprint.

**Set at invocation, never inferred.** Both modes are persisted at S6 and the recorded values govern on resume. The single sanctioned switch is **autonomy `auto` → `human`** on a resume without `--auto`: every auto-mode blocker needs a human, so a resume that could not take the human's seat would re-hit the same wall forever. A downgrade only adds oversight. The reverse is never taken — authorization to merge without asking is granted at a run's start, not retrofitted onto half-done work. `$DELIVERY` never switches on resume. (A downgraded resume rebuilds its gate panel from the artifacts, since auto mode does not write `## Pending gate`.)

**Decision policy (auto).** At each gate, take the choice the human panel would *recommend* — the agents' own verdict — and record why:
- Accept the agents' structured output (the planner's plan, **rung**, and phase set, a `sound` design, upheld findings). **Never downgrade the planner's rung** — there is no human to catch an over-eager downgrade. The upward bumps are automatic and not a stop.
- A planner `NEEDS-CONTEXT` is mechanical: re-invoke `context` (`deepen`); after 2 deepens, re-invoke the planner with `$CONTEXT_FINAL: true`. Only an escalation to `NEEDS-DESIGN` after that, or a genuine inability to plan, hits the boundary.
- **Prefer proof over guessing.** Where a load-bearing choice can be settled empirically, run a spike (throwaway `coder` PoC) rather than reason to an answer. Log the spike and its finding.
- When a rule is ambiguous, take the safe, reversible option and log the alternative not taken.
- Resolve the gate with the same Zone 2 entry human mode writes, attributed to `run (auto)`.
- For an *inline* y/n prompt outside a gate, take the safe option and log it: **do not** mutate `devloop-profile.md` / `devloop-baseline.md` or create/close GitHub issues on a guess; where input is missing (e.g. a profile command), proceed with it **absent for this run** and log it — never block on a convenience prompt.

**The boundary — stop-the-line.** Auto mode never fabricates a judgment it structurally cannot make. It stops at:
- coder stuck after 3 attempts on a task;
- `new` (non-baselined) test failures it cannot fix;
- a test that cannot be made to fail meaningfully after two bounces off the `red` check — a test nobody has seen fail is not evidence;
- a test still unwritable after two `narrow-interface` widenings — the design is the problem;
- a design critique still `needs-work` after one iteration, or a designer `CONFLICT: ADR-NNN`;
- a plan task that reverses an ADR / design prohibition (gate-plan check 2);
- `REFACTOR` coverage `THIN`;
- an AC with **no production call path** that one scoped wiring task could not close;
- a rebase/merge conflict, or an agent `ERROR:`;
- a **manual-workflow** issue.

**To stop the line:** append a blocker entry to Zone 2 and a `## Log` line; append a journal line with outcome `blocked` (`cat >> .context/devloop-journal.md`, **never `Edit`**; script-derived date; areas from `git diff --name-only`, **never composed** — see [the journal](#the-project-journal)) — **before exiting; there is no after**; release the lock; exit with the issue left in-progress. *"Tried, stopped deliberately, state on disk"* is the most expensive fact in a project to rediscover.

A manual *acceptance criterion* is **not** a stop: auto mode tries to automate it, else flags it for the human. An **unreachable** AC *is* a stop if it can't be wired: a flag says "a human must check this"; an empty trace says "this does not work", and carrying it as a flag is how it merges with a tick beside it.

---

## Reference

### Artifacts

| Path | Scope | Writer | Purpose |
|---|---|---|---|
| `.context/sprints/work/issue-N/context.md` | issue | `context` (Zone 1); `designer`/`planner`/`test-critic`/`test-writer`/`coder`/`reviewer` + run append Zone 2 | retrieved facts + decision timeline |
| `.context/sprints/work/issue-N/design.md` | issue | `designer` | implementation guide / decision doc (when a design phase ran) |
| `.context/sprints/work/issue-N/plan.md` | issue | `planner` | `Rung:` + ordered tasks with acceptance; carries the rung's licensing section — `## Triviality proof` (EXPRESS), `## Coverage` (REFACTOR), `## Inertness proof` (TRIVIAL) |
| `.context/sprints/work/issue-N/test-plan.md` | issue | `planner` (critiqued by `test-critic`) | STANDARD only: purpose reading, per-behavior **proof** (`test` scenarios / `observe` check / `none`), e2e flows. Format: `skills/run/test-strategy-spec.md` |
| `.context/sprints/work/issue-N/spike/` | issue | `coder` (spike) | throwaway PoC; safe to delete |
| `.context/sprints/work/issue-N/logs/` | issue | `coder`, `test-runner` | raw check output — cited under **Artifacts**, never loaded by default |
| `.context/sprints/work/issue-N/run-state-final.md` | issue | **run** (cleanup) | the archived state file, for post-mortem |
| `.context/sprints/state/issue-N.md` | issue | **run only** | position, branch, pr, plan, tasks, log — **while in progress** |
| `.context/sprints/state/.lock` | global | **run** + `pr-fix` + `tinker` + `vibe` | `holder`, issue or PR number, `pid`, `start` |
| `.context/devloop-profile.md` | project | roadmap; **run write-back** | build/test commands + test layout |
| `.context/devloop-baseline.md` | project | **run** (on user decision) | accepted-failing tests |
| `.context/devloop-journal.md` | project | **run**, `tinker`, `vibe`, `review`, `architect`, `abort` | one line per finished episode |
| `.context/devloop-unproven.md` | project | `tinker` | behavior shipped without a test by decision — read by `review` and `plan` |

`work/` and `state/` are run's working area; the rest are shared project records. run neither assumes nor enforces a gitignore policy.

### context.md Zone 2 — the shared timeline

An **append-only** timeline: entries in execution order, nobody edits or deletes a prior one. Every entry opens with:

```
### [<$NOW>] · <author> · <ref>
```

then `Did` / `Decisions` / `Caught by` / `For next` / `Artifacts`. **Never `##`** — it opens a second top-level "Zone 2" that everything later nests under, and drops the author that resume matches on. (The observed corruption: `## Zone 2 — Agent notes` copied with the timestamp substituted in.)

**Append with `cat >> …/context.md <<'EOF'` — never `Edit`.** An `Edit` lands wherever its anchor matched, routinely next to similar prose or inside Zone 1; `>>` cannot write anywhere but the end, and resume trusts the last entry. If you cannot append, say so rather than editing one in.

A step that creates a supplementary artifact lists its path under **Artifacts** with a one-line "load this if…" hint.

**Who appends:**
- `designer`, `planner`, `test-critic`, `test-writer`, `coder`, `reviewer` — one entry each when they finish (per their contracts).
- `context` — owns Zone 1 and writes **one seed entry** recording its depth tier: the first, correctly formatted example every later appender sees.
- **run** — one entry at each gate decision (a human's, or `run (auto)`'s with reasoning) and whenever it changes shared state: plan reshaped/accepted, findings accepted/declined, ACs confirmed or flagged, a failure baselined, an auto-mode blocker.
- `test-runner` **never writes Zone 2** — it returns buckets and a log path, and run records them. Writing its own log to `$LOG_DIR` is evidence capture, not state mutation.

**Detection provenance.** Any entry that records a defect carries **`Caught by:`** — `test-red` · `typecheck` · `lint` · `reviewer` · `critique` · `validation` · `spike` · `demo` · `human` (`demo`/`human` are written by `/devloop:review`). Without it nobody can tell, across issues, which gates are load-bearing and which never fire.

**Evidence goes in a log, not in Zone 2** — every downstream agent loads Zone 2, so a stack trace there taxes all of them for one late reader:

| Tier | Where | Content |
|---|---|---|
| **Signal** | Zone 2 entry | failing test id, one-line error, `Caught by:`, log path under **Artifacts** |
| **Evidence** | `work/issue-N/logs/<timestamp>-<what>.log` | raw output |

Pass `$LOG_DIR` = `$WORK_DIR/logs/` (absolute) to `coder` and `test-runner`; each returns its log path.

**Timestamps are script-derived — never the session clock** (it may be stale). Before invoking an appending agent, and before writing your own entry:

```
node -e "console.log(new Date().toISOString())"
```

Pass it as `$NOW`; the agent uses it verbatim. **One derivation per invocation — never reuse a `$NOW` across two agent calls.** Resume compares timestamps against the phase start line and the retro reads elapsed time; entries sharing a stamp carry no order. Reuse it only within one agent's own entry and log filenames.

### The project journal

`.context/devloop-journal.md` is the project-level surface: the `context` agent scans it on **every** issue and pulls entries whose code areas intersect the work into Zone 1 (*What happened here before*) — how a later issue learns a value was hand-tuned and is not a mistake to clean up. Format: `skills/tinker/journal-spec.md`.

run writes one line at exactly two moments — [Issue-complete cleanup](#issue-complete-cleanup) (`shipped`) and an auto-mode stop-the-line (`blocked`):

```
- YYYY-MM-DD · run #[ISSUE] · shipped · `src/auth/**` · [what it did, and why anything non-obvious is that way] → `sprints/work/issue-[ISSUE]/`
```

The rules, restated at both write sites: `cat >>`, **never `Edit`** (in a file of near-identical lines an anchor matches the wrong one); date from `node -e "console.log(new Date().toISOString().slice(0,10))"`; areas from `git diff --name-only $base...<branch tip>` collapsed to directory globs — **derived mechanically, never composed** (a plausible wrong area silently poisons retrieval for every future issue). One line; never rewrite an earlier line — a correction is a new line. If the file is absent, create it with the spec's header and append.

### State file schema

```markdown
# Issue N — run state

issue: N
workflow: feature | bugfix | design | scaffold | manual
rung: trivial | express | standard | refactor | -   # set at gate-plan; '-' until then / non-code workflows
autonomy: human | auto           # set at S6; rewritten only to 'human' on a downgraded resume
delivery: direct | pr            # set at S6; never rewritten on resume
phase: <phase name>
phase_step: -        # multi-pass phases (design/plan/review/validate): last step COMPLETED; '-' = none yet
task_index: -        # build loop, 0-based: next task to run, incremented after one completes
branch: <branch>     # '-' until created
base: <base branch>
pr: -                # set once PR created
merge-commit: -      # the squash/merge SHA on $base; set at merge
history-ref: -       # refs/devloop/issue-N — the branch as built, archived at merge (local only)

## Plan (confirmed at gate-plan)
rung:   trivial | express | standard | refactor
phases: context, [design,] plan, build, e2e, review, validate, <gate-deliver | gate-pr>, merge
gates:  gate-plan ✓, gate-review, gate-validation, <gate-deliver | gate-pr>

## Pending gate        # written before a gate is presented; cleared when resolved
gate: <gate name>
payload: |
  <the structured return that builds the panel — findings, scorecard, validation results, PR body>

## Tasks
- [ ] 1. ...

## Log
- <ISO timestamp> <event>
```

Append a `## Log` line at every phase boundary and human decision.

**`phase:` is written on entry** — so a crash resumes into the right phase. **`phase_step:` / `task_index:` are written on completion** — every step value is past-tense (`drafted`, `reviewed`, `critiqued`, `auto-checked`, `gated`) — **immediately after the agent returns, before parsing it**, in the same edit as the `## Pending gate` payload when a gate follows. A marker written before invoking makes "about to run the reviewer" and "the reviewer finished" identical on disk, and resume re-runs the most expensive agent in the loop.

---

## Startup

Run on every invocation, in order.

### S1 — Resolve the active sprint

Capture `$REPO_ROOT` = `pwd`. Every path passed to an agent (`$WORK_DIR`, `$LOG_DIR`, anything under them) is built as `$REPO_ROOT/...` and handed over **absolute**. `coder` and `test-runner` run check commands that often `cd` into a subpackage (`cd apps/web && npm test`), and that `cd` persists — a relative log path lands under the subpackage.

Read `.context/sprints/master-plan.md` and take the entry with `- **Status:** active` (sprint number and `Sprint file:`); if none, the highest `.context/sprints/sprint-N.md`. If no sprint file exists:

> No active sprint found — run `/devloop:plan` first.

Stop. Otherwise extract `$SPRINT_N`, `$SPRINT_FILE`, `$SPRINT_GOAL`, `$SPRINT_DEMO` (the `**Demo:**` line — unset on older sprint files), `$REPO`, and the ordered issue checklist.

### S2 — Concurrency guard

Read `.context/sprints/state/.lock` if present. PID liveness: `kill -0 <pid> 2>/dev/null` (exit 0 = alive).

| Lock | Action |
|---|---|
| live PID, `holder: run` | `⚙ run is already in progress for #M (PID alive). Finish or /devloop:abort it first.` → **exit** (regardless of `$ISSUE`). |
| live PID, `holder: pr-fix` | `⚙ pr-fix is working the tree on PR #[pr] (PID alive). Let it finish before starting a run.` → **exit**. |
| live PID, `holder: tinker` | `⚙ a tinker session is working the tree (PID alive). Close it (/devloop:tinker → "done") before starting a run.` → **exit**. |
| live PID, `holder: vibe` | `⚙ vibe is building in this tree (PID alive). Let it reach its next demo point first.` → **exit**. |
| dead PID | **Read the fields before deleting** — `holder` (missing = `run`) and, on a `run` lock, `issue:` as **`$LOCK_ISSUE`**. Then `⚠ Found a stale lock from a previous run on #[issue] — clearing it.` → delete `.lock`, proceed. |
| absent | proceed |

A stale lock is the only artifact naming the issue that was in flight; delete it first and S4 is left searching for what was a one-line lookup.

### S3 — Read project profile and baseline

Read `.context/devloop-profile.md`. If absent:

> `.context/devloop-profile.md` not found — run `/devloop:roadmap` to set up build/test commands first, or I'll have to ask for each command as I need it. Continue anyway? (y/n)

**n** → exit. **y** → proceed, asking for commands inline when needed (writing each answer back).

Collect the profile's check commands (`build`, `unit-test`, `typecheck`, `lint`, `e2e-test` — whichever it lists) as **`$CHECKS`**. run never hardcodes this set. A check CI owns is simply not listed; in `--pr` mode branch protection still gates the merge on it, and `direct` has no CI, so the profile's checks are the whole gate.

Read `.context/devloop-baseline.md` if present (absent = empty). Collect its test ids as **`$ACCEPTED`** and pass them to **every agent that runs the suite**, the `coder` included — a suite exits non-zero on an accepted failure too, so a coder without `$ACCEPTED` burns all three attempts on a failure that isn't its own. Drop any baseline entry whose `tracking:` issue is already closed.

### S4 — Resolve the target issue and entry point

Both answered by named files, never by searching.

**1. `$ISSUE`** — first row that applies:

| Condition | `$ISSUE` |
|---|---|
| an issue number in `$ARGUMENTS` | that number (never overridden by a stale lock) |
| `$LOCK_ISSUE` captured in S2 | `$LOCK_ISSUE` |
| `ls .context/sprints/state/issue-*.md` → exactly one | that issue |
| → more than one | list them; ask which to resume or abort |
| → none | the first unchecked issue in `$SPRINT_FILE` |

**"In progress" means exactly a file matching `.context/sprints/state/issue-*.md`.** An empty `state/` is a complete answer — start fresh. `work/issue-N/run-state-final.md` is a post-mortem archive and is **never** consulted here.

**Startup never spawns a search agent.** Every fact it needs is at a path named in S1–S4; a missing file *is* the answer.

**2. Entry point:**

| State file `issue-N.md` | Action |
|---|---|
| exists | If the issue is already closed on GitHub (PR merged or direct merge landed) → entry = **merge** (cleanup only). Else resume the recorded `phase` at the position in `phase_step` / `task_index`. |
| none | Entry = the workflow's entry phase. Warn if `$ISSUE` is not in `$SPRINT_FILE`, but allow. |

If no unchecked issue remains:

> All issues in Sprint [N] are checked off. Run `/devloop:review` to close the sprint.

Stop.

### S5 — Select a starting workflow

Skip on resume — `workflow` and the confirmed phase list in the state file govern. Fetch `$ISSUE`'s labels via GitHub MCP. The workflow is a **starting template** — the planner refines the phase set and the user confirms it at gate-plan.

| Condition | Workflow | Entry phase |
|---|---|---|
| `area:infra` or `type:chore` implying repo/structure creation | **scaffold** | context |
| `type:bug` | **bugfix** | context |
| `type:question` or `type:decision` | **design** | context |
| all other cases | **feature** | context |

A non-structural chore starts as feature; if it has no code to build, the **planner** returns `MANUAL` (the user can also force it at gate-plan). Issues that fit no archetype (review existing code, a spike, mixed design/build) take the nearest template and the planner proposes a custom phase set from the named phases.

### S6 — Acquire lock and dispatch

Write `.context/sprints/state/.lock`: `holder: run`, `issue: $ISSUE`, `pid:`, ISO `start:`. If no state file exists, create `state/issue-N.md` per the schema (`phase: context`, `branch: -`, `autonomy: $AUTONOMY`, `delivery: $DELIVERY`).

On **resume**, read `$AUTONOMY` / `$DELIVERY` from the state file; differing flags warn and change nothing, with one exception: recorded `autonomy: auto` and no `--auto` in `$ARGUMENTS` → `$AUTONOMY = human`, **rewrite the `autonomy:` line to `human`**, append `## Log` line `autonomy downgraded auto → human on resume`. `--auto` on a run recorded `human` warns and stays `human`. `$DELIVERY` never switches.

> **▶ run — Sprint [N] · #[ISSUE] [title] · workflow: [workflow] · mode: [human | auto] · delivery: [direct | pr]**
> [Starting fresh from context. | Resuming from phase "[phase]".]
> [downgraded resume only:] Autonomy downgraded auto → human — gates will stop for you from here.
> [auto only:] Human-on-the-loop — no gates will stop; every decision is logged to context.md for your review. I'll halt only if I hit something I can't decide safely.

Jump to the entry phase. The lock is released on clean exit, at `pending-review`, and at `merge`.

---

## Phase: context

**Active in:** all workflows.

If resuming and `context.md` exists:

> Context for #[ISSUE] was built [relative time] ago ([build timestamp]). Refresh it from scratch? (y/n)

Compute the relative time from the build timestamp in the state log and a script-derived now — never the session clock; if none was recorded, show only the absolute timestamp. **n** → keep it and continue.

Otherwise invoke **`context`** with `$ISSUE`, `$REPO`, `$SPRINT_GOAL`, `$SPRINT_DEMO` (the planner reads both to size the testing), absolute `$WORK_DIR` = `$REPO_ROOT/.context/sprints/work/issue-N/`, a one-line profile summary, and `$NOW`. Request `light` for scaffold, else `full` — the agent **self-calibrates depth** (`minimal`/`standard`/`deep`); run does not dictate it. It writes Zone 1 plus its seed entry and returns its `TIER`. Record the build time and the tier in the state log.

Next: design workflow → `phase: design`; feature/bugfix → `phase: plan`; scaffold → [Scaffold workflow](#scaffold-workflow).

---

## Phase: design

**Active in:** design (always); feature/bugfix after a planner `NEEDS-DESIGN`. Multi-pass — `phase_step`: `drafted → [spiked] → critiqued → gated`.

All design work is the `designer`'s. run holds only return summaries and the file path — never the design content — until gate-design.

1. **Draft** (`drafted`). Invoke **`designer`** (`mode: design`) with `context.md`, the issue's ACs / open questions, and `$NOW`. It writes `design.md` and returns any **`NEEDS-PROOF`** assumptions.

   **ADR conflict.** If it returns `CONFLICT: ADR-NNN — [why]` (no design written), the issue cannot be met within an accepted decision in `.context/decisions/`. Precedence is **ADR > `design.md`**, and overriding an ADR is a supersession owned by `/devloop:architect`, never by run. Human: offer re-scope (re-invoke `designer` with guidance) / take it to `/devloop:architect` then resume from design / abort. Auto: **stop-the-line**.

2. **Spike** (`spiked`, optional). If there are `NEEDS-PROOF` assumptions:

   > The design rests on [n] assumption(s) that need evidence, not reasoning:
   > - [assumption] — would spike: [what to measure]
   >
   > Run a spike to prove these? (all / select / skip)

   For each chosen, invoke **`coder`** (`mode: spike`, `$QUESTION`, `$NOW`) — throwaway code under `work/issue-N/spike/`, commits nothing, returns a `FINDING`. Then re-invoke **`designer`** (`mode: design`, `$SPIKE_FINDINGS`) to fold the evidence in.

3. **Critique** (`critiqued`). Invoke **`designer`** as a **fresh instance** (`mode: critique`) with the `design.md` path and `$NOW`. It scores requirement-coverage, soundness, interface-clarity, interface-completeness, alternatives, simplicity, testability, consistency (`pass`/`concern` each), any spike still recommended, and a `sound`/`needs-work` verdict.

Record `phase: gate-design`.

---

## Gate: gate-design

**Active in:** whenever a design phase ran. `phase_step: gated`.

**Read `design.md` before presenting** — the one gate where run loads the artifact. Every later issue measures conformance against it, and what it fails to say is never checked again (a diff always conforms to a silence). A scorecard plus a link asks for approval of an unread document, and gets a `y`.

Present **three beats, one message each**, waiting for a reply between them, under the [gate-plan pacing rules](#present): end each beat with a question the human can settle from what they just read; "not sure" is free and expands the beat; use the project's words, never *rung* / *phase_step* / *interface-completeness*. Never name a file, symbol, or interface that isn't in `design.md`.

**Beat 1 · What it decides.** The approach in 2–3 sentences and the shape it puts into the codebase (ASCII, `← new`, where it introduces or moves a boundary). Rejected alternatives only on request. → *Is that the right approach for what you want here?*

**Beat 2 · What it commits us to.** The **binding** half — interfaces and boundaries (code blocks are sketches, not decisions). Name **both sides** of every boundary. → *Does this interface let the next caller do the wrong thing?*

**Beat 3 · What it doesn't cover, and what the critique found.** Lead with gaps: coverage, open `concern` rows, assumptions still resting on reasoning. Then:

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

- **Approve** → Zone 2 entry (`$NOW`) recording the approved approach and key interfaces.
  - **design workflow:** offer to create the proposed follow-up story issues (with labels), then [Issue-complete cleanup](#issue-complete-cleanup) (no-PR variant); report `✅ #[ISSUE] — design recorded[; [k] follow-up issue(s) created]`.
  - **feature/bugfix:** `phase: plan` — the planner plans against `design.md`.
- **Request changes** → re-invoke `designer` (`mode: design`) with the feedback, re-critique, re-present.
- **Run another spike** → on the user's question or an open `concern` on testability: design step 2, fold in, re-critique, re-present.
- **Skip design** (feature/bugfix only) → discard the guide, `phase: plan`, re-invoke the planner with `$DESIGN_DECLINED: true` so it does not bounce `NEEDS-DESIGN` again.

**Auto-mode.** No panel; proof over guessing:
- In step 2 run **all** `NEEDS-PROOF` spikes before critiquing.
- If the critique **still recommends a spike**, run it (spike → fold in → re-critique) before deciding, even on `sound`.
- **`sound`** with no spike outstanding → **Approve** path. **`needs-work`** → re-invoke `designer` **once** with the concerns, re-critique; `sound` → approve; still `needs-work` → **stop-the-line**.
- Never **Skip design** — it would override the planner's own call.
- **Mark the approval as unread:** the Zone 2 entry opens with **`AUTO-APPROVED — NO HUMAN REVIEW`** on its own line, naming the verdict it rested on and any concern accepted. A merged diff can still be read afterwards; a design's *silence* cannot — whatever it leaves unstated the build invents, and every later diff still conforms. The marker is how `/devloop:review` finds binding documents nobody read. **Zone 2 only** — never annotate the sprint file, whose markers belong to other skills.

---

## Phase: plan

**Active in:** feature, bugfix. Multi-pass at `STANDARD` — `phase_step`: `planned → test-critiqued → [revised]`.

Invoke **`planner`** with `context.md`, the issue's ACs and Definition of Done, `$HAS_UNIT_TESTS`, `$HAS_E2E`, `$NOW`, and the `design.md` path if a design phase ran. It writes `plan.md` headed by **`Rung:`** (`TRIVIAL` | `EXPRESS` | `STANDARD` | `REFACTOR`) and, for `STANDARD`, `test-plan.md` (bugfix: root cause first). The other rungs write no test plan, only their licensing section in `plan.md` (`## Inertness proof` / `## Triviality proof` / `## Coverage`).

**Context detour.** `NEEDS-CONTEXT: [fact]` → re-invoke **`context`** (`$MODE: deepen`, `$GAP:` the fact, `$NOW`), which appends to Zone 1, then re-invoke the planner. **Capped at 2 deepens**; then the *issue* is underspecified — re-invoke the planner with `$CONTEXT_FINAL: true` so it plans best-effort and records the residual uncertainty (human: shown at gate-plan; auto: logged, or stop-the-line if it escalates to `NEEDS-DESIGN`). A deepen returning `unresolved` counts against the cap — the planner may be assuming something absent.

**Design detour.** `NEEDS-DESIGN: [why]` → run the [design phase](#phase-design) and gate-design, then re-invoke the planner with the approved `design.md` (or `$DESIGN_DECLINED: true` if skipped — no loop).

**Manual detour.** `MANUAL: [why]` → set `workflow: manual`, `phase: gate-manual`, jump to [gate-manual](#gate-gate-manual). No plan, branch, or build/test/review/PR phase; gate-plan is bypassed.

**Test critique** (`STANDARD` only). Nobody else has read the test plan, and everything after builds, red-verifies and trusts it — a missing edge is never added later, a filler test is kept forever. When the planner returns `PLAN:` at `STANDARD` (write `phase_step: planned`):

1. Invoke **`test-critic`** — a **fresh instance** — with `$WORK_DIR`, `$SPEC` = the absolute path of `skills/run/test-strategy-spec.md`, `$TEST_GLOBS` from the profile, and a fresh `$NOW`. It judges both directions: missing edge/error/permission cases, and filler scenarios; and whether the purpose reading matches the evidence. Write `phase_step: test-critiqued` and the findings to `## Pending gate` the moment it returns.
2. **`VERDICT: sound`** → continue. **`VERDICT: revise`** → re-invoke **`planner`** with `$TEST_CRITIQUE` = the findings and a fresh `$NOW`; it revises `test-plan.md` in place and returns any `DECLINED:` findings with reasons. Write `phase_step: revised`.
3. **No second critique** — a critique of the revision finds something new in new text and never converges. The human sees what changed and what was declined at gate-plan beat 3.

**Whenever the planner writes a new `test-plan.md` later** (a rung changed to `STANDARD` at gate-plan, an `EXPRESS`→`STANDARD` bump), run this critique again before the plan is used.

Auto-mode runs the same steps without stopping. Record `phase: gate-plan`.

---

## Gate: gate-plan

**Active in:** feature, bugfix.

### Build the execution plan

run owns the phase list. From the workflow default, adjust to the rung:
- **`STANDARD`** — `build` (micro-loop per task) → e2e → review → validate → deliver.
- **`EXPRESS`** / **`REFACTOR`** — [collapsed path](#the-collapsed-path) build; **single-pass** review; validate runs; e2e dropped unless profile + plan call for it.
- **`TRIVIAL`** — collapsed build on the inert edit; **no review, no validate, no e2e**. Gates: gate-plan and the delivery gate, where the human confirms the prose ACs from the diff.

Then:
- **e2e** only if `test-plan.md` has flows marked `Proof: test` **and** the profile has `e2e-test`. A `Proof: observe` flow goes to validate.
- **review** if the DoD includes "Code reviewed" (never `TRIVIAL` — no executable surface). **validate** if the issue has ACs (never `TRIVIAL` — no symbol to trace).
- Count build tasks from `plan.md`.

When the issue doesn't match its archetype, compose any sensible subset/order of named phases (e.g. review + validate only for "review existing code"; `context → plan → gate-plan` then done for an investigation). Design is never composed here — it sits upstream.

Gates that fire: `gate-plan`, `gate-review` (if review active), `gate-validation` (if any AC is manual / not test-backed), and the delivery gate — `gate-deliver` (direct) or `gate-pr` (pr).

### Two checks on the plan, before anything expensive runs

**1 · Every `STANDARD` task has a proof.** Each task in `plan.md` needs at least one behavior in `test-plan.md` with a `Proof:` line — `test` with a scenario, `observe` with a check, or `none` with a reason. A task with no behavior is seeded as a vacuous test, bounces twice, and escalates on the smallest item in the plan. It is a **planning defect**: re-invoke the `planner` to fold it into the task it serves. **Never ask for a scenario to fill the slot** — all-`observe`/`none` is a legitimate task, and a filler test is trusted forever. Note any reshaping at the gate. (Skipped at the other rungs.)

**2 · No plan task reverses a binding prohibition.** For each accepted ADR or `design.md` that Zone 1 lists as bearing on this issue, extract its **negative constraints verbatim** (sentences with *never*, *must not*, *cannot*, *is not*, *may not*) and place each beside the plan task touching the same surface. A reversal is a **stop-the-line — in auto mode too** (precedence ADR > `design.md`; supersession belongs to `/devloop:architect`). Human mode: surface it here and let the human decide; never proceed on an inferred yes. Everything downstream measures conformance against the plan, so a contradiction surviving this gate is baked into code, tests, and review alike — and it is plain once the two sentences sit side by side.

### Present

**Pace to the rung.** A wall of text gets a `y`, because *approve?* has no answer the human can reach from it. `TRIVIAL`/`EXPRESS`/`REFACTOR` get one panel. `STANDARD` gets **three beats, one message each**, waiting for a reply between them. Rules at every beat:

- **End with a question the human can settle from what they just read** — "does `validateInvite()` belong in `lib/auth/session.ts`?", not "approve?".
- **"Not sure" costs nothing** — it expands the beat (open the file, show surrounding code) and re-asks. If it costs more than "yes", the gate is decorative.
- **Use the project's words.** Not *rung*, *phase*, *phase_step*, *micro-loop*, *Zone 2* — "5 tasks, test-first each".

**Never name a file, symbol, or scenario that isn't in `plan.md` / `test-plan.md`** — an invented filename is exactly what this gate exists to catch, and looks identical to a real one. The human can cut the pacing short ("just go") — honor it and go to **On approval**.

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
| E2E | [scenario list] |  ← omit if not active (always for TRIVIAL)
| Review | [STANDARD: diff review + critique] [EXPRESS/REFACTOR: single review pass] |  ← omit if not active (always for TRIVIAL)
| Validate | [K] acceptance criteria ([M] need manual check) |  ← omit for TRIVIAL
| Deliver | [branch] → [base] · [merge locally (direct) \| open PR (pr)] |

> Gates I'll stop at:
> ① now — approve this plan [STANDARD: + test strategy]
> ② after review — approve findings before fixes  ← list only active gates
> ③ after validate — verify [M] ACs manually
> ④ [direct: before merge — confirm merging to [base] \| pr: before PR — approve PR content]
>
> Approve, or reshape (e.g. "skip e2e", "skip review", "make this STANDARD", "this is a refactor", "this is just docs", "open a PR"):

#### Three beats — `STANDARD`

**Beat 1 · Where this lands.** What exists now and what this issue adds, from Zone 1 and `plan.md`'s `Touches:` lines. **Draw it** (ASCII, `← new`) when the change spans more than two files.

> **#[ISSUE] — [title]**
>
> [what's already here, and where this change sits in it]
>
> [ASCII sketch, `← new` on what this issue adds]  ← when it spans >2 files
>
> Does that match how you think about this part of the system?

**Beat 2 · The tasks, and where the code goes.** One line per task, with its files. Mark every new *home*: a file that doesn't exist yet (**+ new**), **and** a symbol landing in an existing file that Zone 1's `Where new code goes` did not name (**+ new home**). This is the last moment placement is free — afterwards it is a refactor, and the reviewer's placement finding is leashed to a named destination, so it misses the commonest drift: a function appended to the nearest existing file, which creates no new file at all.

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

**The rationale is quoted from `Placement:`, never composed** — run has no file tree in hand here, and an invented justification is unfalsifiable. A marked row with no `Placement:` line: say *"the plan doesn't say why this file"*; filling it is the planner's job.

If the human moves something, re-invoke the `planner` with the destination as a constraint and re-present — run never rewrites `plan.md`. Log the move to Zone 2 with the **user as author**.

**Beat 3 · How it gets proven, and where you'll be asked again.** The one moment to say *"too much for a demo"* or *"you missed the expired-link case"* before any test exists. Read everything from `test-plan.md` and the critique in `## Pending gate`; never compose a scenario.

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

Then the stage table, gate list, and approve/reshape line from the one-panel template. **Reshaping proof** ("just check the page by eye", "test the permission case too") re-invokes the `planner` with the request as a user-authored `$TEST_CRITIQUE` finding, then re-presents this beat. The planner's decline rule does not apply to a user's finding — except that dropping the test on a behavior touching data, money, auth, secrets, an irreversible operation, or a consumed contract is said back once, plainly, before it is honored. Log to Zone 2 with the **user as author**.

#### Reshaping

Apply any reshaping asked for (drop/add a stage, switch workflow, change the rung) and re-present until approved.

**Changing the rung re-invokes the `planner`, in every direction.** A rung is a flag *plus* its licensing artifact — `test-plan.md` (STANDARD), `## Triviality proof` (EXPRESS), `## Coverage` (REFACTOR), `## Inertness proof` (TRIVIAL) — a plan carries at most one, and **only the planner writes it**. Re-invoke with **`$RUNG`** = the requested rung as a constraint (without it the planner re-derives the rung and hands the reshape back), then re-present. There is no honor-in-place case: a proof run invents is run doing the planner's job, and that proof is the whole license for skipping the front half. The planner still reports honestly within the rung — a user-ordered `REFACTOR` over thin tests comes back `Coverage: THIN`. The user sets the rung, not the evidence for it. Log the change to Zone 2 with the **user as author**.

Reshaping to "this is a design task" routes through the design phase; "this is a manual task" switches to the manual workflow and [gate-manual](#gate-gate-manual), with no branch.

**Auto-mode.** No panel, no reshaping: accept the planner's rung, plan, and computed gates (never downgrade the rung). Append a Zone 2 entry with plan, rung, phases, and gates, then **On approval**. Planner detours (`NEEDS-CONTEXT`, `NEEDS-DESIGN`, `MANUAL`) are still honored. Check 2's reversal is still a stop.

### On approval

1. Create the branch from `$base`: `feat/issue-N-<slug>` (feature) or `fix/issue-N-<slug>` (bugfix); `<slug>` = kebab-cased, truncated title.
2. Write the confirmed `rung:`, `phases:`, `gates:` lines; mark `gate-plan ✓`.
3. Record `phase:` = first active execution phase (`build`; or `validate` / the delivery gate if build was dropped).

---

## Gate: gate-manual

**Active in:** the manual workflow. The human does the work outside the repo and confirms the ACs. No branch, plan, tests, or PR.

Before presenting, write the payload (the issue's ACs from the issue body + the planner's `MANUAL` reason) to `## Pending gate`.

> **Manual task — #[ISSUE]: [title]**
>
> The planner judged this has no code to build: [planner's MANUAL reason].
> Complete these yourself, then confirm each:
>
> - [ ] [acceptance criterion from the issue body]
> - [ ] [acceptance criterion]
>
> Confirm all done (y / list the ones still blocked):

- **y** → Zone 2 entry (`$NOW`) recording which criteria the user confirmed; then [Issue-complete cleanup](#issue-complete-cleanup) (no-PR variant), report `✅ #[ISSUE] done — manual task completed, sprint file updated.`
- **Some blocked** → Zone 2 entry with the blockers; ask: **leave open** (exit, lock released, issue in-progress) / **abort** (`/devloop:abort`). Never tick the checkbox or close the issue while any criterion is unmet.

**Auto-mode.** Never attempt or fake completion. Zone 2 entry + `## Log` line `blocked: manual task requires human action` + journal `blocked` line (stop-the-line rules), release the lock, exit:

> ⏸ #[ISSUE] is a manual task — auto-mode can't complete it. Do the work, then run `/devloop:run [ISSUE]` (no `--auto`) to confirm the criteria.

The missing `--auto` downgrades the resume to human, so it lands here as a human gate. Never tell the user to re-run with `--auto` — it blocks again.

---

## The TDD micro-loop

The cycle turning one unit of intent into committed, verified code. Used in **exactly two places**, with identical steps 1–4 — a blocker fix that skipped the red check would be as untrustworthy as a task that did, so the two must never drift:

| Caller | `$SEED` | `test-writer` mode | `coder` mode |
|---|---|---|---|
| build phase (per `STANDARD` task) | the task's `Proof: test` scenarios in `test-plan.md` | `unit` | `implement` |
| gate-review (per blocker) | the review finding | `regression` | `fix` |

**1 · Write the test.** Invoke **`test-writer`** with `$SEED`, the mode, `$WORK_DIR`, `$NOW`, and the `design.md` path if one exists. It writes failing tests; it does **not** run them.

> **Narrow-interface round-trip.** `BLOCKED: narrow-interface` (symbol, what the test needs, minimal widening) means the production interface is too narrow to use as the behavior requires — forcing a cast would bury that and ship it. **Not a coder attempt.** Invoke **`coder`** (`mode: fix`) with the widening as its task, then re-invoke the test-writer. Auto mode resolves this without stopping; log it to Zone 2 so the interface change is visible at review. **Cap 2.**

**2 · Verify red.** Invoke **`test-runner`** (`mode: red`) with the test files, `$LOG_DIR`, `$NOW`. Nobody else ever sees the failing state — without this step "the test failed first" is an assumption.

| Verdict | Action |
|---|---|
| **`RED`** — failed on a real assertion | continue to step 3 |
| **`RED-SETUP`** — broken import / syntax / fixture | back to `test-writer` with the error (it would go green once setup is fixed, having tested nothing) |
| **`GREEN`** — passed with no implementation / against the bug | back to `test-writer` — vacuous. For a blocker it means **the bug isn't understood**; never patch on top of that |

**Cap 2**; never hand the coder a test that hasn't been seen to fail properly.

**3 · Code.** Invoke **`coder`** with `$SEED`, the mode, `plan.md` (when it exists), `context.md`, the `design.md` path if one exists, `$NOW`, `$LOG_DIR`, **`$CHECKS`**, `$ABSENT`, and **`$ACCEPTED`**. It makes the tests pass and commits **only when all `$CHECKS` pass**.

> **Missing-command round-trip.** `RESULT: blocked` + `MISSING: <check>` → **not an attempt**. Ask:
>
> > The coder needs a **[check]** command, which isn't in the profile. What command runs it? (or `none` if this project has no [check]):
>
> Write the answer to the profile ([Profile write-back](#profile-write-back)), or record `none` so it isn't asked again; re-invoke with the updated `$CHECKS` and `$ABSENT` (checks marked `none`). Auto: proceed with the check absent for this run and log it. **Cap 2.**

**4 · Verify green — the verdict.** Invoke **`test-runner`** (`mode: unit`) with the test files, `$UNIT_CMD`, the baseline path, `$LOG_DIR`, `$NOW`. It returns **new / accepted / pre-existing** buckets and a `LOG:` path; handle per [Known-failing baseline](#known-failing-baseline). `new` failures block. It is usually green — the point is that it **classifies** against the baseline (the coder sees only an exit code) and **independently verifies** the agent that wrote the code and wanted it to pass. Believe the test-runner.

**5 · Did the fix build a new layer? (gate-review caller only.)** `git diff --name-status` over the fix's commits. An **`A`** entry under a source path is a surface no `test-plan.md` scenario was written against, and the regression test (written from the finding's prose, before this code existed) cannot have covered it. Loop back to `test-writer` **once**, scoped to the new module: cover every element it exposes, or name what was left and why. Then `test-runner` (`mode: unit`); failures are `new` and go to the coder. **No red check** — this code already exists, so red would bounce every passing test as vacuous; failing tests are the finding, passing ones are retained coverage. A fix that only edits files skips this step.

### The back-half rule

Steps 3–4 are the **back half**: the coder's full `$CHECKS` commit gate plus the test-runner's independent classification. **`STANDARD`, `EXPRESS`, and `REFACTOR` all run the complete `$CHECKS`** — a rung flexes only the front half (steps 1–2), and never drops a profile check, because the existing suite and fitness functions can still break.

**`TRIVIAL` is the one exception**, by definition: no checkable surface. It runs only the subset of `$CHECKS` a touched path feeds (usually none), licensed by the planner's `## Inertness proof` and **re-verified on the real post-edit `git diff`** before any check is skipped; the moment the diff touches a checked path it bumps to `EXPRESS` and runs everything. **Nothing that could observe the change is ever skipped.**

### Bounds — every loop is capped

An uncapped retry is a hang, and auto mode has no human to notice one.

| Signal | Kind | Counts as a coder attempt? | Cap | On exhaustion |
|---|---|---|---|---|
| `BLOCKED: narrow-interface` (step 1) | round-trip | no | **2** | escalate (human) / stop-the-line (auto) — the design is wrong, not the interface |
| `MISSING: <check>` (step 3) | round-trip | no | **2** | proceed with the check absent for this run, and log it |
| `RED-SETUP` / `GREEN` (step 2) | failure | no | **2** | escalate / stop-the-line |
| `BLOCKED:` — tests won't pass (step 3) | failure | **yes** | **3** | escalate / stop-the-line ([build](#phase-build)) |

---

## Phase: build

**Active in:** feature, bugfix. The path follows the state file's `rung:`.

### STANDARD path

Per task in `plan.md` at `task_index` (0-based), by its behaviors' proofs in `test-plan.md`:
- **Any `Proof: test`** → [the micro-loop](#the-tdd-micro-loop) with `$SEED` = the task. The test-writer takes only the `test` scenarios; the coder builds the `observe`/`none` behaviors alongside.
- **All `observe` / `none`** → skip steps 1–2: `coder` (`implement`) builds to acceptance, then step 4. Never send the test-writer "just in case" — that is the test the critique removed.

Then mark the task `[x]`, increment `task_index`, append a log line.

**Escalation.** Coder fails **3 attempts** on one task:

> Stuck on task [i] "[task]" after 3 attempts. Last failure:
> ```
> [output]
> ```
> How do you want to proceed? **retry** / **edit the plan** / **accept as known-failing** (needs a tracking issue) / **abort** (`/devloop:abort`)

Auto: stop-the-line. When all tasks are `[x]`: `phase:` = `e2e` if active, else `review`.

### The collapsed path

`EXPRESS`, `REFACTOR`, and `TRIVIAL` skip the front half (no test-writer, no red). Each has exactly one proof licensing that:

| Rung | The change | Proof | If the proof does not hold |
|---|---|---|---|
| **EXPRESS** | trivial; nothing live depends on it | **triviality** (*first*) — grep the `## Triviality proof` targets: callers of a removed symbol → zero, readers of a changed constant → none coupled, blast radius → empty | **auto-bump to STANDARD** |
| **REFACTOR** | behavior-preserving restructure of used code | **coverage** (*first*) — the tests named in `## Coverage` pass on the **current** code | `THIN`/absent → **surface** (human: add coverage first / accept the risk; auto: **stop-the-line**) — never refactor blind |
| **TRIVIAL** | inert; whole files no check reads | **inertness** (*after* the edit) — `git diff --name-only` ⊆ `## Inertness proof` targets, each consumed by no `$CHECKS` command | **auto-bump to EXPRESS** |

**EXPRESS / REFACTOR** — per task:

1. **Run the proof**, output to `$LOG_DIR`. EXPRESS failing → **bump to `STANDARD`**: re-invoke `planner` with **`$RUNG: STANDARD`**, run the [test critique](#phase-plan) on the new `test-plan.md`, set `rung: standard`, Zone 2 `Caught by: validation`, restart this phase on the STANDARD path. One-way ratchet, no cap.
2. **Apply.** Invoke **`coder`** (`mode: express`) with `$SEED` = the task, `plan.md`, `context.md`, `$NOW`, `$LOG_DIR`, **`$CHECKS`**, `$ABSENT`, **`$ACCEPTED`**. Commits only when all `$CHECKS` pass. `MISSING:` round-trip applies. (`NOTE: not-trivial` on EXPRESS → bump as in step 1.)
3. **Verify.** **`test-runner`** (`mode: unit`) with `$UNIT_CMD`, the baseline, `$LOG_DIR`, `$NOW`. A `new` failure means:
   - **EXPRESS** — the change touched real behavior → **bump to STANDARD**.
   - **REFACTOR** — the restructure **changed behavior** → `coder` fixes it by restoring the behavior (still REFACTOR); 3 failed attempts → escalate / stop-the-line.

   Mark `[x]`, increment `task_index`, log.

**TRIVIAL** — per task, apply *then* prove on the real diff:

1. **Apply.** Invoke **`coder`** (`mode: express`) with `$SEED`, `plan.md`, `context.md`, `$NOW`, `$LOG_DIR`, `$ABSENT`, `$ACCEPTED`, and as its checks **only the `## Inertness proof` `Subset to run`** (usually empty) — never the full `$CHECKS`. `RESULT: blocked` / `NOTE: not-trivial` → **bump to EXPRESS**.
2. **Verify inertness.** `git diff --name-only` for the task's commit: every path must be (a) within the `## Inertness proof` targets and (b) consumed by no `$CHECKS` command. If it holds, run only the `Subset to run` (via `test-runner` `unit` when it includes tests). If not → **bump to EXPRESS**: re-invoke `planner` with **`$RUNG: EXPRESS`**, set `rung: express`, Zone 2 `Caught by: validation`, restart on the EXPRESS path with full `$CHECKS` (a failing check bumps onward to STANDARD). One-way, no cap.

   Mark `[x]`, increment `task_index`, log.

When all tasks are `[x]`: EXPRESS/REFACTOR → `review` (else `validate`); TRIVIAL → the delivery gate (`gate-deliver` / `gate-pr`).

---

## Phase: e2e

**Active in:** feature, bugfix — only with e2e flows marked `Proof: test`. A `Proof: observe` flow is never built here; its check goes to [validate](#phase-validate).

If the profile has no `e2e-test` command:

> The plan includes E2E scenarios but the profile has no `e2e-test` command. Provide one now (I'll save it), or skip E2E for this issue? (command / skip)

Invoke **`test-writer`** (`mode: e2e`, `$FRAMEWORKS` = the profile's e2e framework — never assumed) for the `Proof: test` flows, then **`test-runner`** (`mode: full`), which starts the profile's `dev-server`, runs the suite, and returns buckets. Handle per [Known-failing baseline](#known-failing-baseline); a `new` failure → `coder` (`fix`).

**No red check** — these tests are written against existing code, so red would bounce every good one (`skills/run/test-strategy-spec.md` § 6).

Record `phase: review`.

---

## Phase: review

**Active in:** feature, bugfix at `STANDARD` (two passes) or `EXPRESS`/`REFACTOR` (single pass). **Never `TRIVIAL`.** `phase_step`: `reviewed` → `critiqued` → `gated`. run holds structured verdicts, never the diff.

**Depth.** `EXPRESS`/`REFACTOR` skip step 2 — no new behavior and the proof already ran, but a code change never gets zero eyes. A **blocker on an `EXPRESS`** change contradicts the triviality claim → set `rung: standard`, log the bump, and run the critique pass. **This bump does not re-plan**: the licensing artifact governs the front half, which is already built; what the bump buys is a second pass, and the blocker gets its own red-verified regression test in step 4. `plan.md` keeps its falsified `## Triviality proof` as the honest record. A blocker on `REFACTOR` is fixed in place and stays `REFACTOR`.

1. **Review** (`reviewed`). Derive `$NOW`; invoke **`reviewer`** (`mode: review`) with **`$BASE`** = the state file's `base:`, **`$HEAD`** = the branch tip, absolute `$WORK_DIR`, **`$CHECKS`** (reference only — the reviewer runs nothing), **`$DESIGN`** = the `design.md` path if one exists, and `$NOW`.

   **Record it done before you read it.** On return, write `phase_step: reviewed` and the findings into `## Pending gate` before parsing. This call is **not idempotent**; on an ambiguous resume use the [last-entry check](#how-this-skill-works) — never re-review "to confirm".

   **Always pass the range explicitly.** It is the review's scope, and an improvised one returns confident findings about the wrong code — or `FINDINGS: 0` on an empty diff — indistinguishable from a clean review. The reviewer diffs three-dot, so base drift since the split stays out.

   It returns findings on its full rubric (`agents/reviewer.md`: correctness, test-pass-insufficient incl. the newly-exported-symbol sweep, blast radius, risk, design conformance to the **binding** half, placement, simplicity, consistency), each `blocker` or `refactor`. **It is the same rubric a PR gets** — on `direct` delivery there is no PR, no CI, and no human between this pass and `main`.

2. **Critique** (`critiqued`) — *STANDARD only.* Fresh `$NOW`; invoke **`reviewer`** as a **fresh instance** (`mode: critique`) with pass 1's findings as **`$FINDINGS`**, the **same `$BASE`/`$HEAD`** (a second opinion on a different diff is not one), `$WORK_DIR`, **`$DESIGN`** if one exists, and `$NOW`. It returns `uphold`/`drop` per finding with a reason. **`$DESIGN` is not optional**: without it critique rules on conformance findings it cannot read and drops them.

   It may return **`NEW`** findings — restricted to blocker-class correctness; treat them exactly like upheld blockers.

3. **gate-review** (`gated`). Merge the passes:

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

   Omit empty buckets. The user has final say on everything.

   **Blockers and disputed findings carry a failure scenario** — the input or state that triggers it and what goes wrong — because a finding names the defect, not its cost, and that is the judgment the human is making. Take it from the reviewer's return; if the return doesn't support one, say so — **never invent one** (a plausible invented failure gets upheld on sight). Use the project's words: "the invite check is skipped when the token has already expired", not "guard clause unreachable in `validateInvite`".

4. **Apply** — the coder in `fix` mode.

   **Blockers** (upheld, new, or disputed-and-confirmed) **ship with a regression test**: a blocker is a bug the whole suite already ran over and missed, so re-running it after a bare patch proves nothing. Each goes through [the micro-loop](#the-tdd-micro-loop) with `$SEED` = the finding, **including step 5**.

   `NOT-REPRODUCIBLE: [why]` from the test-writer (design divergence, untriggerable timing, no observable behavior) → accept it; skip steps 1–2, apply the fix, **record the reason in Zone 2**. Never accept a faked test in its place.

   **Refactors** change no behavior → **no new test**: `coder` (`fix`) applies each accepted one (human mode: offered to the user first), `test-runner` (`unit`) verifies. If any was applied and e2e is active, re-run `test-runner` (`full`).

**Auto-mode.** No panel. Apply **upheld** blockers and refactors; apply **new** findings; apply **disputed blockers** (safe = fix the possible bug); skip **disputed refactors** (safe = don't churn working code); leave **dropped**. Apply as in step 4. A fix that can't pass, or a regression test that won't go red in two tries → **stop-the-line**. Log every per-finding decision, including any blocker shipped `NOT-REPRODUCIBLE`.

Append a Zone 2 entry (`$NOW`) with the gate outcome (upheld, dropped, overridden; by user or `run (auto)`), **`Caught by:`** per applied finding (`reviewer` for pass 1, `critique` for one pass 1 missed), and the regression tests and logs under **Artifacts**.

Record `phase: validate`.

---

## Phase: validate

**Active in:** feature, bugfix at `STANDARD`/`EXPRESS`/`REFACTOR` — **never `TRIVIAL`** (no symbol to trace; its ACs are confirmed at the delivery gate). `phase_step`: `auto-checked` → `gated`. gate-validation fires if there are manual ACs or by-eye checks, or any AC failed its trace.

Cross-check the ACs and DoD against what was delivered:
- **Automated ACs / DoD** — satisfied only when a passing test covers it **and** it is **reachable from a production entry point** ([below](#reachability-a-green-test-is-not-a-satisfied-ac)). "PR merged to main" cannot be checked yet — leave it.
- **By-eye checks** — every `Proof: observe` check in `test-plan.md`. Presented with the manual ACs; **never automated**, and **never written to `.context/devloop-unproven.md`** (that ledger is for a due test that was overridden).
- **Manual ACs** — at gate-validation:

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

A unit test verifies a symbol against its own contract and cannot notice it has no callers; typecheck and lint accept an unused export; the reviewer sees a module and its tests land together, green and complete-looking. This phase is the only gate positioned to catch the difference. For **each automated AC**, answer **"what production call path exercises this?"**:

1. Identify the symbol(s) the AC rests on (function, guard, validator, schema, route, resolver).
2. `grep -rn <symbol>` across the **non-test** tree.
3. **Name the path**, composition root inward: `AC1 → src/index.ts → createApp() → src/feature/handler.ts:41 → handleRequest()`. It must end at a real entry point (CLI command, HTTP route, exported package API, scheduled job, composition root), not at another uncalled module.
4. **Name the producer.** For each value the assertion depends on (key, index, ordering column, hash, derived id or timestamp, serialized field), name the production code that *writes* it — **one hop back, then stop**. Check the test-writer's `FIXTURE-BYPASS:` lines in Zone 2: an AC resting on a value a **test supplied by hand** rather than one the producer emits is **not verified**.
5. **Name what comes back.** Where the AC is about what a caller *receives* (reply, serialized result, ordered read, status), say what it gets and **whether anything has exercised that return** — **one hop out, then stop**, by grepping the tests. If the surface exposes N elements and tests drove one through the real boundary, report `1 of N`.

Steps 1–3 answer *does control reach the code*; 4–5 cover the two directions a forward grep is blind to.

Four failure shapes — all **unmet ACs**:
- **Nothing calls it** — only its definition and its own test reference it.
- **Something calls it, but nothing real feeds it** — its inputs come only from test-built objects, or a fixture hand-writes a value production derives differently; it stays green through any fix and any regression.
- **It runs, and what comes back is unusable** — malformed shape, dropped payload, error swallowed into success; the caller can't tell it from "nothing happened" and retries what already succeeded.
- **The declared return is unreachable** — every branch into the symbol throws or is impossible given the caller's preconditions, so its signature promises a value the running system never produces.

**What the trace proves:** control reaches the code, its values come from production, and something has exercised the way back out. It is static — not a proof of correctness (the reviewer's) or of behavior under real conditions (the outer-loop demo's). Don't claim more.

**Never tick an AC because its test is green when any step comes up empty.**

**Unmet AC or DoD item** (including a failed trace):

> [k] of [total] criteria are unverified: [list]. Continue to delivery anyway? (y/n)

Proceed only on explicit **y**. On **n**, return to the relevant phase (build for a failed behavior or missing call path, e2e for a failed flow); re-run only the downstream phases the change affects (a build fix re-runs review and validate).

**Auto-mode.** Run the **full five-step trace** — it is mechanical, and auto mode is where nobody reads the diff before merge. A failed trace is a **demonstrable defect, not a flag**: route it back to **build** as one scoped task (coder → test-runner → review), **once per AC**. If the fix needs a decision the run isn't entitled to (which entry point calls this, whether the producer or the test is wrong, whether the design intended this path) → **stop-the-line** with the failed trace.

**By-eye checks are never automated** — a `Proof: observe` check, or a manual AC whose behavior the plan marked `observe`/`none`, is carried as `needs manual verification` exactly as written. A test written here would silently reverse a critiqued decision.

For **other manual ACs** (no proof decision in the plan), try to remove the human dependency: `test-writer` + `test-runner` write and run a test. A pass verifies it — **and still needs a trace** (a test the loop wrote is the loop vouching for itself). A failure is a `new` failure (coder fix; unfixable → stop-the-line in auto). Unautomatable → mark **unverified**, log it, carry it as `needs manual verification` — in the PR body (`pr`) or Zone 2 (`direct`); never waive silently. Auto mode does not stop at gate-validation for these.

Append a Zone 2 entry (`$NOW`): criteria confirmed and how; **the traced path for each automated AC, verbatim**; **the producer (step 4) and return-path answer (step 5)**, including `N of M` ratios and any AC resting on a `FIXTURE-BYPASS` value; ACs waived on override; ACs left `needs manual verification`. Where a step could not be answered (no runnable surface, no identifiable producer), **say so explicitly** — silence reads as a pass. A failed trace is recorded with **`Caught by: validation`** and the grep under **Artifacts**; `/devloop:review` reads these traces.

Record `phase:` = `gate-deliver` (direct) or `gate-pr` (pr).

---

## Gate: gate-deliver

**Active in:** feature, bugfix with `delivery: direct`. No PR.

Write the payload (summary + validation checklist) to `## Pending gate`, then:

> **Ready to merge — #[ISSUE]: [title]**
> [branch] → [base]  ·  direct merge, no PR
>
> [one-paragraph summary from `plan.md`]
> [validation checklist — incl. any `needs manual verification` items]
> [TRIVIAL only — no validate phase ran, so confirm the prose ACs from the diff here:]
> [- [ ] [acceptance criterion — e.g. "README documents the new env var"]]
>
> Merge to [base] now? (y / edit / open a PR instead)

- **y** → `phase: merge`, [merge phase](#phase-merge) (direct). For `TRIVIAL`, also append a Zone 2 entry recording the prose ACs as human-confirmed.
- **edit** → adjust the summary / merge-commit message, re-present.
- **open a PR instead** → set `delivery: pr` in the state file, `phase: gate-pr`, continue there.

**Auto-mode.** No panel — this is the authorized endpoint. Zone 2 entry, `phase: merge`, continue.

---

## Gate: gate-pr

**Active in:** feature, bugfix with `delivery: pr`.

Push the branch. Build the PR: title = the issue title; body = `Closes #[ISSUE]`, a one-paragraph summary from `plan.md`, and the validation checklist (incl. `needs manual verification` items).

Human mode — create the PR via GitHub MCP after:

> **PR ready — #[ISSUE]**
> [branch] → [base]
> [title]
>
> [body preview]
>
> Approve to open the PR for review? (y / edit)

On approval record `pr:` and continue to [pending-review](#phase-pending-review).

**Auto-mode.** Open the PR without the prompt and **do not halt**: record `pr:`, Zone 2 entry, `phase: merge`, continue to the merge phase.

---

## Phase: pending-review

**Active in:** `delivery: pr` + `autonomy: human` — the only cell that halts before merge.

Record `phase: pending-review` and `pr:`. **Delete the lock** — the PR is in human/CI hands. Exit:

> **#[ISSUE] → PR #[pr] is open and awaiting review.**
>
> - Review it: `/devloop:pr-review [pr]`
> - Address comments: `/devloop:pr-fix [pr]`
> - **No CI:** once approved, run `/devloop:run [ISSUE]` to merge and clean up.
> - **With CI:** once approved, CI merges and closes the issue via `Closes #`; then run `/devloop:run [ISSUE]` to finish sprint cleanup.

Stop.

---

## Phase: merge

**Active in:** feature, bugfix. Reached from gate-deliver, gate-pr / pending-review, or S4 when the issue is already closed.

### delivery: direct

1. Rebase the branch on `$base` if behind. Conflict → surface it and stop (resolve manually or `/devloop:abort`; auto: stop-the-line).
2. Merge into `$base` locally — **squash** by default — with `Closes #[ISSUE]` in the message. Push `$base`.
3. [Preserve the history](#preserve-the-history) **before** deleting the branch. Then delete it.
4. [Issue-complete cleanup](#issue-complete-cleanup).

✅ report: `✅ #[ISSUE] done — merged to [base], issue closed, sprint file updated.`

### delivery: pr

Re-check the PR via GitHub MCP. **Approved** = a formal GitHub approval **or** the `status:reviewed` label with no open `REQUEST_CHANGES` review (a solo dev's `pr-review` sign-off — GitHub forbids approving your own PR).

| PR state | Action |
|---|---|
| merged | skip merge → cleanup |
| open, approved | rebase if behind base, then merge |
| open, not approved | `PR #[pr] is not approved yet — run /devloop:pr-review and /devloop:pr-fix first.` → exit |

**Merge method:** the repo's single allowed method; if several:

> Merge #[pr] by **squash / rebase / merge commit**?

**auto + pr:** "not approved" does not bar the merge (`--auto` is the standing approval), but required checks / branch protection still gate it, and rebase-if-behind and the conflict rule apply. With several methods, pick **squash** if available, else the first allowed, and log the choice.

Rebase conflict → surface and stop (resolve manually or `/devloop:abort`).

Once merged, [Preserve the history](#preserve-the-history) — the merge SHA comes from the merge call; archive from the local branch, which still holds the per-task commits. Then [Issue-complete cleanup](#issue-complete-cleanup).

✅ report: `✅ #[ISSUE] done — PR #[pr] merged, issue closed, sprint file updated.`

### Preserve the history

A squash makes the per-task commits unreachable once the branch goes, leaving the coder's Zone 2 SHA citations dangling for `/devloop:review`.

1. **While the branch still exists**, archive its tip:

   ```
   git update-ref refs/devloop/issue-[ISSUE] <branch-tip-sha>
   ```

   A custom ref namespace keeps the commits alive through `gc` without appearing in `git branch` / `git tag -l`. **Local only — never push it**; `review` runs on the machine that ran the sprint.

2. **Record both refs** in the state file (they ride into `run-state-final.md`) and in a Zone 2 entry:

   ```
   merge-commit: <sha on $base>
   history-ref:  refs/devloop/issue-[ISSUE]
   ```

   The merge SHA lets `review` anchor the diff exactly instead of grepping `$base` for `Closes #[ISSUE]` (which finds `#4` inside `#42`).

If `update-ref` fails, log it, write `history-ref: -`, and continue — the merge SHA is the load-bearing record. Scaffold: record its commit range as `merge-commit:`, `history-ref: -`. Design and manual workflows produce no commits.

### Issue-complete cleanup

The terminal every workflow ends with:

1. **Close the issue:**
   - PR merge, or direct merge to the default branch — `Closes #` already closed it; verify.
   - **No-PR variant** (design, manual, scaffold) **or a direct merge to a non-default base** — ask `Close #[ISSUE] on GitHub? (y/n)`; on **y**, close via GitHub MCP with a comment on how it was completed.
2. **Tick the issue's checkbox `[x]` in `$SPRINT_FILE` — touch only the checkbox.** Neighboring lines may carry `✓accepted YYYY-MM-DD`; never copy it onto this or any line — it is `review`'s marker, and on run's line it would make an unreviewed, auto-merged issue look human-accepted.
3. **Archive the state file, then release the lock.** Move `state/issue-N.md` → `work/issue-N/run-state-final.md`, then delete `state/.lock`. Never leave `issue-N.md` in `state/` — S4 would read it as in-progress.
4. **Append the journal line** ([format](#the-project-journal)):

   ```
   - YYYY-MM-DD · run #[ISSUE] · shipped · `<areas>` · [what shipped, and why anything non-obvious is that way] → `sprints/work/issue-[ISSUE]/`
   ```

   `cat >> .context/devloop-journal.md`, **never `Edit`**; script-derived date; areas from `git diff --name-only` over the issue's own range, collapsed to globs — **mechanically, never composed**. Create the file with the spec header if absent. This is the only record a *later* issue reads.
5. Leave `work/issue-N/` in place.
6. Print the ✅ report (wording from the calling terminal), then **"Move to the next issue? (y/n)"** — **y** → Startup S4 as the no-arg case; **n** → exit. **Auto mode skips the prompt** and exits — one invocation, one issue; sequencing is `/devloop:sprint`'s.

---

## Scaffold workflow

**Phases:** context (light) → scaffold → profile write-back → done. No branch, tests, or PR.

Invoke **`scaffolder`** with the issue, `$REPO`, and the intended structure. It creates the repo if needed, bootstraps the structure, and commits directly to the base branch; it checks for existing files first, so a resumed scaffold doesn't clobber earlier work. Capture the commands, test layout, and frameworks it established and run [Profile write-back](#profile-write-back). Then [Issue-complete cleanup](#issue-complete-cleanup) (no-PR variant):

> ✅ Scaffold complete for #[ISSUE]. Project profile updated with the new commands.

---

## Known-failing baseline

`.context/devloop-baseline.md` is the shared allowlist of accepted-failing checks. `test-runner` returns:

| Bucket | Meaning | run's action |
|---|---|---|
| **new** | failing + attributable to this task | **block** — resolve before continuing |
| **accepted** | failing + matches a baseline entry | don't block — report the count |
| **pre-existing** | failing + not baselined + not from this task | dedupe vs open GitHub issues, then offer per group: **file issue** / **baseline it** / **ignore** |

**New failures:**

> [k] new test failure(s) introduced by this task:
> - [test] — [one-line reason]
>
> **fix** (keep iterating) / **accept as known-failing** (needs a tracking issue) / **abort**

**Accept as known-failing** — require a tracking issue (existing, or create a `type:bug` now), then append with a script-derived `$NOW`:

```markdown
- check: unit | e2e
  test: <test id>
  reason: <why accepted>
  tracking: #<issue>
  added: <$NOW>
  added-by: issue #[ISSUE]
```

and a Zone 2 entry recording it. (Auto: never baseline on a guess — an unfixable `new` failure is a stop-the-line.)

**Auto-clean.** A baselined test now **passing**:

> A baselined test now passes: [test] (tracking #[t]). Remove it from the baseline and close #[t]? (y/n)

On **y**, remove the entry and close the tracking issue with a comment.

---

## Profile write-back

`.context/devloop-profile.md` is machine-maintained. run updates it only when (1) scaffold established the commands — write them all, or (2) a task **filled a previously-empty field** (e.g. the first test script). Never diff or rewrite it on every commit. Confirm first:

> The project now has a [field] command: `[command]`. Save it to the profile so future runs use it? (y/n)

Write only confirmed fields; never overwrite a non-empty field without asking.

---

## Exception handling

Handled where they occur: coder stuck ([build](#standard-path)), the micro-loop's round-trips and caps ([Bounds](#bounds--every-loop-is-capped)), `NOT-REPRODUCIBLE` ([review](#phase-review)), new failures ([baseline](#known-failing-baseline)), conflicts ([merge](#phase-merge)). Also:

- **Agent returns `ERROR:`** — surface it; offer **retry** / **skip** (where safe) / **abort**. Auto: stop-the-line.
- **GitHub MCP failure** — report; retry once on the user's go-ahead; otherwise continue where the step is non-critical (an optional label), exit where critical (PR creation, merge).
- **Crash mid-run** — leaves lock and state file; the next invocation's stale-PID check clears the lock and the recorded position resumes the work.
- **Resuming after an auto-mode blocker** — `run [ISSUE]` without `--auto` resumes in human mode (S6), the intended answer to every blocker. With `--auto` it stays auto and re-blocks — occasionally right (a conflict resolved out-of-band), never the way to *answer* a blocker.
