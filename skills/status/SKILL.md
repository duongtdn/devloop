---
description: Show a read-only progress snapshot of the current or a specified sprint — issue statuses, in-progress step, and milestone due date and progress. Pass a sprint number to view a specific sprint (e.g. /devloop:status 3).
---

You are running **devloop:status**. This skill is read-only — it fetches and displays sprint state without making any changes. No human gates are needed; render the snapshot and exit.

User may have passed a sprint identifier via `$ARGUMENTS` (e.g. `sprint-3`, `3`, `s3`). Parse any of these forms to extract the sprint number `$SPRINT_N`. If `$ARGUMENTS` is non-empty but contains no recognisable number, warn before falling through to auto-detect:

> Argument "[ARGUMENTS]" doesn't look like a sprint number — resolving the active sprint instead.

---

## Step 0 — Resolve sprint

If `$ARGUMENTS` is non-empty and contains a number, parse it as `$SPRINT_N`.

If `$ARGUMENTS` is empty (or unrecognised per the note above):
- Read `.context/sprints/master-plan.md` if it exists.
- Find the sprint entry that contains `- **Status:** active` (the exact bold-formatted list item written by `/devloop:plan`). Use its sprint number as `$SPRINT_N`. If multiple entries match, use the one with the highest sprint number and emit: `Multiple active sprints found in master plan — using Sprint [N].`
- If no sprint is active, use the highest sprint number present in the Sprint Map.
- If `.context/sprints/master-plan.md` does not exist, scan `.context/sprints/` for files matching `sprint-N.md` and use the highest N found.

If no sprint can be resolved:

> No sprint files found. Run `/devloop:plan` to start your first sprint.

Stop.

---

## Step 1 — Read local artifacts

Read these files for Sprint `$SPRINT_N`:

1. **Sprint file:** `.context/sprints/sprint-[N].md` — issue list and checkboxes, goal, milestone number, repo, created date.
2. **Lock file:** `.context/sprints/state/.lock` — if it exists, read the active issue number, PID, and start time.
3. **Issue state files:** `.context/sprints/state/issue-*.md` — for each file present whose issue number is in the sprint file, read: `workflow`, current step name, branch name, task checklist (done vs total), last log entry. Some workflows have no build tasks (a `manual` or `design` issue) and no branch (`branch: -`) — note when the task list is empty or absent and when `branch` is `-`.

If the sprint file does not exist:

> Sprint [N] file not found at `.context/sprints/sprint-[N].md`. If this sprint was planned, the file may have been moved or deleted.

Stop.

Extract from the sprint file:
- `$SPRINT_GOAL` — from the `**Goal:**` line
- `$MILESTONE_NUMBER` — from the `**Milestone:**` line (the number after `#`)
- `$REPO` — from the `**Repo:**` line
- `$CREATED` — from the `**Created:**` line
- Issue list — all `- [ ]` and `- [x]` lines, in order. Each line may carry trailing annotations per the sprint-file line grammar (`plan-spec.md` in the plan skill): strip `⚠ unassigned` before parsing, and capture `✓accepted YYYY-MM-DD` (written by `/devloop:review` when a human accepted the task) as `$ACCEPTED[N] = date` before stripping it too. Then extract the issue number, title, and labels.

**Lock detection.** If `.lock` exists:
- Read `$LOCK_HOLDER` (`run`, `pr-fix`, `tinker` or `vibe`; a missing field predates the `holder` field — treat as `run`), `$LOCK_PID` (PID), and `$LOCK_START` (start time). When `$LOCK_HOLDER` is `run`, read `$LOCKED_ISSUE` from `issue:`; when it is `pr-fix`, read `$LOCKED_PR` from `pr:`; when it is `tinker`, read `$LOCKED_SESSION` from `session:`. In every case but `run`, leave `$LOCKED_ISSUE` unset — those holders own the tree but are not a sprint run, so no sprint issue is in flight.
- Determine PID liveness by running `kill -0 $LOCK_PID 2>/dev/null`. Exit code 0 means the process is alive; non-zero means it is gone. If the shell call cannot be made, treat the lock as live (safe default).
- Set `$LOCK_STATE`:
  - `live` — lock file exists and process is running
  - `stale` — lock file exists but process is not running
  - `absent` — no lock file

---

## Step 2 — Fetch GitHub data

**Issue statuses.** For each issue number in the sprint file, call the GitHub MCP to get the issue's current state (`open` or `closed`).

If GitHub MCP calls fail (token missing, network error, or repo not found), proceed without live GitHub data and set `$GITHUB_UNAVAILABLE = true`.

**Open PRs.** Call the GitHub MCP to list open pull requests in `$REPO` with `perPage: 100`. If exactly 100 results are returned, paginate until fewer than 100 are returned in one page. For each sprint issue number N, check whether any open PR matches either of these anchored patterns (these mirror what `/devloop:run` actually creates — head branch `feat/issue-N-<slug>` or `fix/issue-N-<slug>`, body `Closes #N`):
- Head branch matches `feat/issue-N-` or `fix/issue-N-`, with N immediately followed by `-` (the anchor prevents `issue-4-` matching `issue-42-...`)
- Body contains a `Closes #N` or `Fixes #N` keyword, with N immediately followed by a non-digit character or end of string (prevents `#4` matching inside `#42`)

Record as `$PR_MAP[N] = PR_number` (first match per issue). If the PR list call fails, skip silently.

**Milestone health.** Read the milestone via the **bundled github-extras MCP's milestone-listing operation** (`owner`, `repo`, `state: all` — the sprint's milestone may already be closed), then pick the entry whose `number` is `$MILESTONE_NUMBER`. The **official** GitHub MCP has no milestone tools at all, so don't look for one there. Extract:
- `$MILESTONE_DUE` — from `due_on`; render the ISO date only, or `no due date` when it is null
- `$MILESTONE_OPEN` — `open_issues`, the count of open issues under this milestone
- `$MILESTONE_CLOSED` — `closed_issues`

If the call fails, or no milestone with that number is returned, set all three to `unknown` and continue — never infer a due date or a count that wasn't returned.

---

## Step 3 — Compute per-issue status

For each issue in execution order, determine its display status using the first matching rule:

| Priority | Condition | Status |
|----------|-----------|--------|
| 1 | GitHub state is `closed` | `done` |
| 2 | Checkbox is `[x]` and GitHub state is `open` | `done ⚠` |
| 3 | Checkbox is `[x]` and GitHub unavailable | `done` |
| 4 | `$LOCK_STATE` is `live` and issue number matches `$LOCKED_ISSUE` | `in progress` |
| 5 | Issue has a state file with a recorded step (and `$LOCK_STATE` is not `live`) | `stale` |
| 6 | Otherwise | `not started` |

**`done ⚠`** — the local sprint file marks the issue done but GitHub still shows it open. A common cause is a merged PR without a `closes #N` keyword.

**`stale`** — a previous `run` left a state file but no live lock is present. The issue is not actively being worked. The next `run` invocation will clean up stale state before resuming.

**Closed-while-locked.** If `$LOCK_STATE` is `live` and `$LOCKED_ISSUE` resolves to status `done` via rule 1 (GitHub closed it while `run` was active), keep the `done` status in the table. Record this as `$CLOSED_WHILE_LOCKED = true` for the banner in Step 4.

---

## Step 4 — Render snapshot

Print the full snapshot using this layout:

**Header**

```
## Sprint [N] — [SPRINT_GOAL]

Repo: [owner/repo]  ·  Milestone: #[number]  ·  Created: [date]
Milestone: [MILESTONE_CLOSED] closed / [MILESTONE_OPEN] open  ·  Due: [MILESTONE_DUE]
```

Omit the second `Milestone:` line entirely if all milestone health fields are `unknown`.

If the master plan shows this sprint with `- **Status:** completed`:

```
> Sprint [N] is marked completed.
```

**Lock banner** — select exactly one based on `$LOCK_HOLDER`, `$LOCK_STATE`, whether `$LOCKED_ISSUE` is in the sprint's issue list, and `$CLOSED_WHILE_LOCKED`. A `pr-fix` holder is checked first — it holds the tree but is not a sprint run, so the issue-based rows do not apply:

| `$LOCK_HOLDER` | `$LOCK_STATE` | `$LOCKED_ISSUE` in this sprint | `$CLOSED_WHILE_LOCKED` | Banner |
|---|---------------|-------------------------------|------------------------|--------|
| `pr-fix` | `live` | — | — | `⚙ pr-fix is working PR #[LOCKED_PR] on the working tree (not a sprint run).` |
| `pr-fix` | `stale` | — | — | `⚠ Stale pr-fix lock (PR #[LOCKED_PR]) — exited uncleanly. The next /devloop:run or /devloop:pr-fix will clear it.` |
| `tinker` | `live` | — | — | `⚙ A tinker session ([LOCKED_SESSION]) is changing the working tree (not a sprint run).` |
| `tinker` | `stale` | — | — | `⚠ Stale tinker lock ([LOCKED_SESSION]) — exited uncleanly. /devloop:tinker will offer to resume or close that session.` |
| `vibe` | `live` | — | — | `⚙ vibe is building in this tree (not a sprint run).` |
| `vibe` | `stale` | — | — | `⚠ Stale vibe lock — exited uncleanly. The next /devloop:vibe will clear it.` |
| `run` | `live` | yes | false | `⚙ In progress: #[N] — [title] (since [start time])` |
| `run` | `live` | yes | true | `⚙ #[N] was closed on GitHub while run is still active — it may be wrapping up.` |
| `run` | `live` | no | — | `⚙ run is active on #[N] (a different sprint) — this snapshot is for Sprint [current sprint].` |
| `run` | `stale` | yes or no | — | `⚠ Stale lock for #[N] — run exited uncleanly. The next /devloop:run will auto-clear this.` |
| any | `absent` | — | — | _(no banner)_ |

**Issue table**

| # | Order | Title | Area | Status | PR | Reviewed |
|---|-------|-------|------|--------|----|----------|
| #44 | 1 | Add session persistence | infra | `done` | #10 | ✓ 07-08 |
| #43 | 2 | Add JWT middleware | api | `done` | #12 | awaiting review |
| #42 | 3 | Add login page | web | `not started` | — | — |

- **#** — issue number
- **Order** — position in the sprint file (1-indexed)
- **Title** — stripped title from the sprint file (no label suffixes, no annotations)
- **Area** — `area:*` label stripped of prefix, or `—` if none
- **Status** — `done`, `done ⚠`, `in progress`, `stale`, or `not started`
- **PR** — PR number from `$PR_MAP`, or `—`
- **Reviewed** — human acceptance, orthogonal to Status (under autonomous execution an issue merges and closes *before* anyone reviews it): `✓ [date]` if `$ACCEPTED[N]` is set, `awaiting review` for a `done`/`done ⚠` issue without it, `—` otherwise. Omit this column entirely if no issue is `done` yet.

If any issue has status `done ⚠`, add a footnote after the table:

```
⚠ Marked done locally but GitHub still shows open — verify the PR merged with a closes keyword.
```

If any issue has status `stale`, add a footnote:

```
⚠ Stale: state file present with no active lock. /devloop:run will resume or clean up automatically.
```

**In-progress detail** — if a state file exists for any `in progress` issue, add one detail line per such issue immediately below the table and footnotes:

```
  #[N]: [workflow] · step "[current step name]"  ·  tasks [X done]/[Y total]  ·  branch [branch name]
```

Include each segment only when it carries meaning, so a task-less or branch-less workflow doesn't render filler:
- **tasks** — include only when the state file has a non-empty task list (a TDD `build` loop). Omit it entirely for a `manual`/`design` issue or before any tasks exist, rather than showing `0/0`.
- **branch** — include only when `branch` is set (not `-`). Omit for a workflow that creates no branch.

So a manual issue at its gate renders simply `#[N]: manual · step "gate-manual"`.

**Summary line**

```
[X] done ([A] accepted · [P] awaiting review) · [Y] in progress · [Z] stale · [W] not started · [Total] total
```

Omit any count that is zero (drop the parenthetical entirely when nothing is done). If `$GITHUB_UNAVAILABLE` is true, append:

```
(GitHub unavailable — showing local state only)
```

**Closing hint** — print exactly one of the following, using the first matching condition:

| Condition | Hint |
|-----------|------|
| All issues `done`, some `awaiting review` | `All issues done — [P] awaiting review. Run /devloop:review to review and close the sprint.` |
| All issues `done`, all accepted | `All issues done and accepted. Run /devloop:review to close the sprint.` |
| One or more `stale`, none `in progress` | `Run /devloop:run to resume — stale state will be cleaned up automatically.` |
| One or more `not started`, none `in progress` or `stale` | `Run /devloop:run to start the next issue — or /devloop:sprint to execute the rest autonomously.` |
| Otherwise | _(no hint)_ |
