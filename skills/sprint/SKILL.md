---
description: Execute the whole active sprint autonomously — the inner loop at sprint scope. Confirms the launch once, then drives run in auto+merge mode over every remaining issue in execution order, merging each PR to main as it lands so later issues build on real code. Stops and reports on the first blocker it can't resolve safely (it never skips ahead past a blocked issue). When all issues are done it hands off to /devloop:review, where the human reviews and accepts each shipped task. Re-invoke after an interruption to resume exactly where it stopped.
---

You are running **devloop:sprint**. This is a **thin orchestrator over `/devloop:run`** — it owns sprint-level sequencing and reporting, nothing else. All execution machinery (phases, gates-as-decisions, state files, lock, merge, cleanup) lives in `run`; never reimplement or shortcut it here.

**Model: merge-as-you-go.** Each issue runs in `run`'s **auto+merge** mode (`--auto --merge`): fully autonomous, and its PR merges to the base branch on completion, so later issues build on code that actually exists — honoring the execution order `plan` computed (e.g. infra → api → web). `main` advances during the sprint; the release point is the tag `/devloop:review` cuts at sprint close. Human oversight is **on** the loop: every decision is logged (`context.md` Zone 2, state logs), and the human passes judgment afterward in `/devloop:review` — accepting tasks or spawning rework issues via `/devloop:replan`.

`$ARGUMENTS` is normally empty. A sprint number (`3`, `sprint-3`) targets that sprint explicitly (it must still be the one you intend to execute — warn if it isn't the active sprint).

---

## Step 1 — Resolve and guard

**Active sprint.** As `run` Startup S1: read `.context/sprints/master-plan.md`, find `- **Status:** active`, use its sprint number and `Sprint file:`; else the highest `sprint-N.md` on disk. No sprint file →

> No active sprint found — run `/devloop:plan` first.

Stop. Read the sprint file: `$SPRINT_N`, `$SPRINT_GOAL`, `$REPO`, and the ordered issue lines (checkbox state per line).

**Lock.** Read `.context/sprints/state/.lock` if present; check PID liveness. A **live** lock (`run` or `pr-fix`) → report who holds the tree and stop (`run` clears stale locks itself on the next invocation — don't touch the lock here).

**Work inventory.**
- `$IN_PROGRESS` — issues with a state file in `.context/sprints/state/` (there should be at most one).
- `$REMAINING` — unchecked issues in sprint-file order.

If both are empty:

> All issues in Sprint [N] are done. Run `/devloop:review` to review and close the sprint.

Stop.

---

## Step 2 — Launch gate *(the one human gate)*

One confirmation before an unattended run that will merge to `[base]`:

> **▶ Sprint [N] — autonomous execution** · _"[SPRINT_GOAL]"_
>
> | Order | # | Title | State |
> |---|---|---|---|
> | 1 | #43 | Add JWT middleware | resume (phase: build) |
> | 2 | #42 | Add login page | fresh |
>
> Mode: **auto + merge** — no gates will stop; each issue's PR merges to `[base]` when it lands. Every decision is logged for `/devloop:review`. I stop at the first blocker I can't resolve safely and never skip past it.
>
> Execute [n] issue(s)? (y / n)

On **n**, exit. On **y**, continue. (When resuming an interrupted sprint run and the plan was already confirmed in a previous session, still show the table — states will reflect the progress — but the confirmation stays: it's one keystroke and re-anchors what's about to happen.)

---

## Step 3 — Execution loop

Work strictly in order: **resume `$IN_PROGRESS` first**, then each `$REMAINING` issue. For each issue `#I`:

1. Announce one line: `— [k]/[n] · #[I] [title] —`
2. Invoke the **`run` skill** (Skill tool) with args `[I] --auto --merge`. `run` does everything: context → plan → build → … → merge → cleanup (tick checkbox, archive state, release lock). Its `autonomy: auto+merge` decision rules and boundary list govern.
3. **Read the outcome** from run's terminal report and the sprint file:
   - **Completed** (checkbox now `[x]`) — report `✓ #[I] done — PR #[pr] merged` and continue to the next issue.
   - **Blocked / halted** (run stopped at a boundary: coder stuck, unfixable new failures, design still needs-work, conflict, agent `ERROR:`, manual-workflow issue) — **stop the whole loop**. Do not move to the next issue: later work may depend on the blocked one, and building past it compounds the damage. Go to Step 4 with `$BLOCKED = #I` and run's reason.
   - **Anything ambiguous** (run exited without a clear completion or blocker) — treat as blocked; never guess an issue completed.

Between issues, nothing else runs — no extra prompts, no plan re-checks; `run` owns each issue end to end.

## Step 4 — Report

**All issues completed:**

> **✅ Sprint [N] executed** — [n]/[n] issues merged to `[base]`.
>
> | # | Title | PR |
> |---|---|---|
> | #43 | Add JWT middleware | #12 |
> | #42 | Add login page | #14 |
>
> Every decision is logged in each issue's `context.md` (Zone 2). **Next: `/devloop:review`** — walk through each task, demo it, accept or spawn rework.

**Stopped on a blocker:**

> **⏸ Sprint [N] paused at #[BLOCKED]** — [run's one-line reason].
> Completed before the stop: [list ✓ issues, or "none"]. Not started: [list].
>
> The blocker needs you: [the specific ask — e.g. resolve the conflict / decide on the stuck task via `/devloop:run [BLOCKED]` in human mode / complete the manual task and confirm at its gate / `/devloop:abort [BLOCKED]`].
> When it's resolved, re-run `/devloop:sprint` to continue from here.

**Interrupted mid-run** (session death, usage limit): nothing is lost — `run`'s state file records the exact phase, and the stale lock auto-clears on the next invocation. Re-running `/devloop:sprint` resumes the in-progress issue first, then continues down the list.

---

## What sprint never does

- Never runs an issue in any mode but `--auto --merge` (a human-gated pass through one issue is plain `/devloop:run`).
- Never skips a blocked issue to work a later one.
- Never touches state files, the lock, checkboxes, or `context.md` — those are `run`'s.
- Never reviews, accepts, tags, reconciles, or closes the milestone — that's `/devloop:review`'s outer loop.
- Never fabricates an outcome: if it cannot tell whether an issue completed, it stops and says so.
