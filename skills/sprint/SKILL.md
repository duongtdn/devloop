---
description: Execute the whole active sprint autonomously — the inner loop at sprint scope. Confirms the launch once, then drives run in auto mode over every remaining issue in execution order, merging each into main locally as it lands (no PRs) so later issues build on real code. Stops and reports on the first blocker it can't resolve safely (it never skips ahead past a blocked issue). When all issues are done it hands off to /devloop:review, where the human reviews and accepts each shipped task. Re-invoke after an interruption to resume exactly where it stopped.
---

You are running **devloop:sprint**. This is a **thin orchestrator over `/devloop:run`** — it owns sprint-level sequencing and reporting, nothing else. All execution machinery (phases, gates-as-decisions, state files, lock, merge, cleanup) lives in `run`; never reimplement or shortcut it here.

**Each issue runs in an isolated subagent.** `run --auto` has no human gates to preserve mid-conversation — every decision is already logged to disk (`context.md` Zone 2, the state file) rather than living only in conversation memory — so there's nothing lost by running each issue's full `context → plan → build → … → merge` pass in its own subagent context instead of inline. This keeps `sprint`'s own context flat regardless of how many issues the sprint has, instead of accumulating every phase and agent call of every issue into one ever-growing conversation.

**Model: merge-as-you-go.** Each issue runs in `run`'s **auto** mode (`--auto`, default `direct` delivery): fully autonomous, and its branch merges into the base **locally with no PR** on completion, so later issues build on code that actually exists — honoring the execution order `plan` computed (e.g. infra → api → web). `main` advances during the sprint; the release point is the tag `/devloop:review` cuts at sprint close. Human oversight is **on** the loop: every decision is logged (`context.md` Zone 2, state logs), and the human passes judgment afterward in `/devloop:review` — accepting tasks or spawning rework issues via `/devloop:replan`. (`sprint` is strictly PR-less; an issue that needs a PR-gated CI check or an audit trail is run on its own with `/devloop:run [issue] --auto --pr`, outside `sprint`.)

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
> Mode: **auto** — no gates will stop; each issue merges into `[base]` locally (no PR) when it lands. Every decision is logged for `/devloop:review`. I stop at the first blocker I can't resolve safely and never skip past it.
>
> Execute [n] issue(s)? (y / n)

On **n**, exit. On **y**, continue. (When resuming an interrupted sprint run and the plan was already confirmed in a previous session, still show the table — states will reflect the progress — but the confirmation stays: it's one keystroke and re-anchors what's about to happen.)

---

## Step 3 — Execution loop

Work strictly in order: **resume `$IN_PROGRESS` first**, then each `$REMAINING` issue. For each issue `#I`:

1. Announce one line: `— [k]/[n] · #[I] [title] —`
2. Spawn a fresh subagent (Agent tool, foreground — `run_in_background: false`, since the loop must wait for the outcome before deciding what's next) to drive this one issue. The subagent starts with no memory of this conversation, so its prompt must be self-contained: instruct it to invoke the **`/devloop:run` skill** with args `[I] --auto`, let it run to completion without deviating or shortcutting any phase (context → plan → build → … → merge locally, no PR → cleanup: tick checkbox, archive state, release lock — governed by `run`'s `autonomy: auto` + `delivery: direct` decision rules and boundary list), and then report back concisely: whether the issue completed (merged) or is blocked/halted, and if blocked, run's one-line reason. Tell it explicitly not to fabricate an outcome — if it can't tell, say so.
3. **Read the outcome** — from the subagent's report, but verified against the sprint file on disk (never take the subagent's word alone):
   - **Completed** (checkbox now `[x]` in the sprint file) — report `✓ #[I] done — merged to [base]` and continue to the next issue.
   - **Blocked / halted** (run stopped at a boundary: coder stuck, unfixable new failures, design still needs-work, conflict, agent `ERROR:`, manual-workflow issue) — **stop the whole loop**. Do not move to the next issue: later work may depend on the blocked one, and building past it compounds the damage. Go to Step 4 with `$BLOCKED = #I` and run's reason.
   - **Anything ambiguous** (subagent report unclear, or its claim doesn't match the sprint file's checkbox state) — treat as blocked; never guess an issue completed.

Between issues, nothing else runs — no extra prompts, no plan re-checks; `run` owns each issue end to end.

## Step 4 — Report

**All issues completed:**

> **✅ Sprint [N] executed** — [n]/[n] issues merged to `[base]`.
>
> | # | Title | Landed |
> |---|---|---|
> | #43 | Add JWT middleware | ✓ |
> | #42 | Add login page | ✓ |
>
> Every decision is logged in each issue's `context.md` (Zone 2). **Next: `/devloop:review`** — walk through each task, demo it, accept or spawn rework.

**Stopped on a blocker:**

> **⏸ Sprint [N] paused at #[BLOCKED]** — [run's one-line reason].
> Completed before the stop: [list ✓ issues, or "none"]. Not started: [list].
>
> The blocker needs you: [the specific ask — e.g. resolve the conflict / decide on the stuck task / complete the manual task and confirm its criteria / abandon it]. Take it up with `/devloop:run [BLOCKED]` — **without `--auto`**, which resumes the issue in human mode at the phase it stopped in and gates it for you — or `/devloop:abort [BLOCKED]` to stand it down.
> When it's resolved, re-run `/devloop:sprint` to continue from here.

**Interrupted mid-run** (session death, usage limit): nothing is lost — `run`'s state file records the exact phase, and the stale lock auto-clears on the next invocation. Re-running `/devloop:sprint` resumes the in-progress issue first, then continues down the list.

---

## What sprint never does

- Never runs an issue in any mode but `--auto` (direct, PR-less). A human-gated pass through one issue is plain `/devloop:run`; a PR-delivered issue is `/devloop:run [issue] --auto --pr`, run on its own outside `sprint`.
- Never skips a blocked issue to work a later one.
- Never touches state files, the lock, checkboxes, or `context.md` — those are `run`'s.
- Never reviews, accepts, tags, reconciles, or closes the milestone — that's `/devloop:review`'s outer loop.
- Never fabricates an outcome: if it cannot tell whether an issue completed, it stops and says so.
- Never trusts a subagent's completion report on its own — always cross-checks the sprint file's checkbox before advancing.
