---
description: Address review comments on a GitHub pull request end-to-end. Checks out the PR branch in your workspace (stashing first if needed), merges the GitHub inline comments with any prior review findings, lets you triage which to fix at a human gate, applies each fix via the coder with the test-runner verifying after each, runs E2E if the project has it, re-reviews the result to catch fix-induced regressions, then — after a final gate — pushes and replies to the comment threads (fixed and skipped). Honors the project profile, the accepted-failure baseline, and an approved design.md.
---

You are running **devloop:pr-fix**. You act as the PR author working through a reviewer's comments: bring the PR branch into your workspace, gather the findings (GitHub comments + any prior review), decide with the user what to fix, apply the fixes with full check/test verification, make sure nothing regressed, then push and reply to the threads — **only after a human gate**.

User may have passed a PR reference via `$ARGUMENTS` (`web#42`, `42`, or empty). Parse it; if empty, detect from the current branch.

---

## How this skill works

**It mutates the working tree.** Unlike a read-only review pass, `pr-fix` writes commits to the PR branch, so it must put that branch into a real checkout. It uses your **main workspace** (not a throwaway worktree) so the fixes build and test against your installed dependencies. Before checking out it verifies the tree is clean and, if not, gates on stashing — and it restores your original branch (and pops the stash) on exit.

**It takes the lock.** Because it shares the main working tree, a concurrent `run` is a hazard — `run` could switch branches mid-fix. So `pr-fix` respects `.context/sprints/state/.lock`: a live `run` for another issue blocks it; otherwise it acquires the lock for the duration and releases it on exit. It writes **no** `issue-N.md` state file — each fix is its own commit, so progress already persists in git; a re-invoke re-reads the findings and continues.

**GitHub via MCP, git via the CLI.** All GitHub operations (PR metadata, review comments, replies, labels) go through `mcp__github`. All repository operations (fetch, checkout, commit, push) go through plain `git` over Bash. **Do not use `gh`** — it is an extra local dependency this plugin does not require.

**Nothing reaches GitHub before the human gates.** The user triages which findings to fix (first gate), and the push + thread replies happen only after a final confirmation (second gate). The `coder` and `reviewer` agents only reason/edit locally; the skill posts.

**Phases.**

```
intake → sync → context → findings → triage (gate) → fix loop → verify → [e2e] → re-review → push + reply (gate)
```

`context` is reused when the PR came from `run`. `e2e` runs only if the profile has an `e2e-test` command.

---

## Reference — artifacts & commands

| Path | Role |
|---|---|
| `.context/sprints/work/issue-N/context.md` | reused if the PR came from `run` (Zone 1 facts + Zone 2 timeline incl. the prior review's findings) |
| `.context/sprints/work/pr-{repo}-{N}/context.md` | built fresh (`context` `pr` mode) for a PR with no usable issue work dir |
| `.context/devloop-profile.md` | the **only** source for build/test commands — never guess one; ask the user and write it back if missing |
| `.context/devloop-baseline.md` | accepted-failure allowlist; passed to `test-runner` so the gate means "no *new* failures" |
| `$WORK_DIR/design.md` | if present, the approved design — `coder` implements to it, `reviewer` checks conformance |

Timestamps are **script-derived**, never the session clock; before invoking any appending agent derive a fresh `$NOW`:

```
node -e "console.log(new Date().toISOString())"
```

---

## Phase: intake

Parse `$ARGUMENTS`:

| Form | Meaning |
|---|---|
| `repo#prN` (e.g. `web#42`) | repo `web`, PR `42` |
| `N` (e.g. `42`) | PR `42` in the current repo |
| empty | detect the open PR for the current branch |

Resolve `$REPO` (`owner/repo`) from git remotes (prefer `origin`). If empty, find the PR whose head matches the current branch via `mcp__github`. If none resolves:

> No PR found — pass a PR number (`/devloop:pr-fix 42`) or check out the PR branch.

Stop. Otherwise fetch PR metadata via `mcp__github`: title, body, base ref, head **ref name** and SHA, author, state, mergeable. Parse the body for a linked issue (`Closes #N`, `Fixes #N`) → `$ISSUE` (may be unset). Capture the authenticated GitHub user → `$ME`. Capture `$HEAD_REF` (the branch name to push back to).

If the PR is **not open**:

> #[pr] is [merged/closed] — there's nothing to push fixes to. Stopping.

Stop. (`pr-fix` only operates on open PRs.) If the PR head is on a **fork** (head repo ≠ `$REPO`), warn that `pr-fix` pushes to same-repo branches only and stop — pushing to a fork is the author's manual step.

Read `.context/devloop-profile.md` for the commands (`build`, `unit-test`, `e2e-test`, `typecheck`, `lint`, `dev-server`) and `.context/devloop-baseline.md` for the accepted set. Announce:

> **▶ pr-fix — [repo]#[pr]: [title]**
> [head] → [base] · by [author][ · closes #ISSUE]

## Phase: sync

Bring the PR branch into the **main workspace**, safely:

1. **Clean-check.** Run `git status --porcelain`. If there are uncommitted changes, stop and gate:

   > Your workspace has uncommitted changes:
   > [list]
   > pr-fix needs a clean tree to check out #[pr]. **Stash and continue**, or **abort**?

   On **abort**, exit having touched nothing. On **stash**, run `git stash push -u` and remember that a stash was created (to pop on exit).

2. **Lock.** Inspect `.context/sprints/state/.lock`. If a **live** `run` holds it for a different issue → refuse:

   > A run is in progress for #[M] — finish or `/devloop:abort` it before fixing this PR.

   Run **teardown** (it pops the stash if you created one; nothing else was changed yet) and stop. A **stale** PID → clear it with a warning. Then acquire the lock with `{pr, pid, start}`.

3. **Checkout.** Remember the current branch (`$PRIOR_BRANCH`). Fetch and check out the PR head branch by name so pushes go back to it cleanly:
   `git fetch [remote] [base-branch] [head-ref]`, then `git checkout [head-ref]` (creating a local tracking branch if needed) and fast-forward to `[remote]/[head-ref]`.
4. **Refs for review.** Pin `$BASE` = the fetched base tip (`[remote]/[base-branch]`) and `$HEAD` = the current branch tip. The re-review later diffs **three-dot** (`$BASE...$HEAD`).
5. **Staleness, noted not fixed.** `git rev-list --count $HEAD..$BASE`. If behind, hold it as a note for the final report — **do not rebase** (that's a force-push the author/`run`'s merge handles). Adding fix commits and pushing is a normal fast-forward push.

## Phase: context

Resolve the work dir and decide reuse vs. fresh:

| Case | Work dir | Action |
|---|---|---|
| `$ISSUE` set **and** `.context/sprints/work/issue-{ISSUE}/context.md` exists | `issue-{ISSUE}/` | **Reuse as-is** — Zone 2 already holds the prior review's findings. |
| otherwise | `pr-{repo}-{pr}/` | Build fresh — invoke `context` (`pr` mode). |

To build fresh, derive `$NOW` and invoke **`context`** (`mode: pr`), passing `$PR`, `$REPO`, `$ISSUE` (if set), `$BASE`, `$HEAD`, the work dir, the `design.md` path if present, and `$NOW`. Set `$WORK_DIR` to the resolved dir and `$DESIGN` to `$WORK_DIR/design.md` if it exists.

## Phase: findings

Assemble the work list from two sources and merge them.

1. **GitHub inline review comments** — fetch the PR's review comments via `mcp__github`. Each carries an id, `path`, `line`, `body`, author, and `in_reply_to`. Skip replies (`in_reply_to` set) and any comment already authored by `$ME` as a `pr-fix` reply. Note which reviews are `CHANGES_REQUESTED` (their comments are blockers by intent).
2. **Zone 2 findings** — if `context.md` exists, read the prior review's Zone 2 entry: finding ids, severities (blocker/suggestion/nit), `file:line`, suggested fixes, and the **posted comment ids** it recorded at submit.

**Merge & dedup**, producing one entry per real finding:
- Match a Zone 2 finding to a GitHub comment by **posted-comment-id first**, then by **(file, line)**. A matched pair is one finding carrying both the rich Zone 2 detail (severity, suggested fix) and the GitHub `thread id` to reply to.
- A GitHub comment with **no** Zone 2 match is a finding on its own (a human reviewer's comment, or a standalone `pr-fix` with no prior review). Parse a leading `**[severity]**` from the body if present; otherwise treat a comment under a `CHANGES_REQUESTED` review as a **blocker** and any other as a **suggestion**, and let the user re-rank at triage.
- A Zone 2 finding with **no** posted comment id (e.g. a "note" never posted) is a finding with **no** GitHub thread — fixable, but recorded only in Zone 2.

Each merged finding holds: `id`, `severity`, `file:line`, explanation, suggested fix, and `thread` (the GitHub comment id to reply to, or none). If the merged list is empty:

> No open review comments or recorded findings on #[pr] — nothing to fix.

Run **teardown** and stop.

## Triage *(human gate)*

Present the merged findings grouped by severity, **blockers first**:

> **Review comments — [repo]#[pr]** ([n] findings)
>
> | id | severity | location | finding | suggested fix | thread |
> |---|---|---|---|---|---|
> | F1 | blocker | file:line | … | … | gh#123 |
> | F2 | suggestion | file:line | … | … | (zone2) |
>
> [Plus: behind base by N — noted for the push]   ← if stale
>
> Which to **fix**? (default: all blockers + suggestions; say which to **skip**, or re-rank any)

The user picks the set to fix (`$TO_FIX`) and the set to skip (`$TO_SKIP`); both get a thread reply later. Re-present until they confirm. Fix in severity order, blockers first.

## Phase: fix loop

For each finding in `$TO_FIX`, derive `$NOW` and invoke **`coder`** (`mode: fix`) — **no new tests** — passing `$WORK_DIR`, the finding as `$TASK` (its explanation + `file:line` + suggested fix), `$CHECKS` (the profile's `build`/`unit-test`/`typecheck`/`lint`), `$ABSENT` (checks the user has marked N/A), and `$NOW`. The coder auto-discovers `design.md` in `$WORK_DIR` and conforms to it; it edits the code, runs the given checks, commits **only when green**, and appends a Zone 2 entry.

- Returns **`MISSING: <check>`** → the profile lacks a command the fix needs. Ask the user, write it back to the profile, and re-invoke — **this is not a failed attempt**.
- Returns **`BLOCKED:`** (can't get to green) → after **3 attempts** on this finding, escalate: **retry / edit the finding / skip it / abort**.

Because the coder runs the unit suite as part of `$CHECKS` before each commit, every fix is already green on its own — there is no per-fix `test-runner` pass. The suite runs **once** after the loop (next) for baseline classification and to catch any cross-fix interaction.

## Phase: verify

After the loop, derive `$NOW` and invoke **`test-runner`** (`mode: unit`), passing `$REPO`, `$UNIT_CMD`, and `$BASELINE` (`$TASK_FILES` may be empty — the whole suite is what matters here). It classifies failures into **new / accepted / pre-existing**:
- **new** → block; a fix regressed something. Route back into the fix loop on the offending finding (within its 3-attempt bound), then re-verify.
- **accepted** → report the count; don't block.
- **pre-existing** → **report the count only.** These were failing before `pr-fix` touched anything; filing/baselining them is `run`'s job, not a fix skill's — don't open the triage ceremony here.

## Phase: e2e

Only if the profile has an `e2e-test` command (skip silently otherwise). After verify passes, derive `$NOW` and invoke **`test-runner`** (`mode: full`), passing `$E2E_CMD`, `$DEV_SERVER`, `$REPO`, and `$BASELINE`. Treat its buckets the same way: **new** E2E failures block and route back into the fix loop; accepted are reported; pre-existing are reported as a count only.

## Phase: re-review

Verify the fixes are correct and introduced no regressions — **reasoning only; nothing is posted to GitHub here.** Derive `$NOW` and invoke **`reviewer`** (`mode: pr-review`), passing `$BASE`, `$HEAD` (now including the fix commits — three-dot), `$CHECKS` (profile `lint`/`unit-test`, reference only), `$DESIGN` if present, and `$WORK_DIR` (so it reads `context.md`). It returns findings classified blocker/suggestion/nit.

- If it surfaces a **new blocker** introduced by the fixes, present it at a gate: **fix again** (back into the fix loop) / **push anyway** / **stop**. Bound this to **2 extra rounds**, then escalate to the user.
- If clean of new blockers (lingering suggestions/nits are fine), proceed to push.

## Push + reply *(human gate)*

This is the outward-facing action — confirm before anything leaves the machine. Show exactly what will happen:

> **Ready to push — [repo]#[pr]**
>
> Commits to push: [k] ([sha] … [sha])
> Replies to post:
> - **fixed** F1 (gh#123) → "Fixed in [sha] — [one line]"
> - **fixed** F2 (zone2, no thread) → recorded in context.md only
> - **skipped** F3 (gh#130) → "[the reason given at triage]"
> [ · removing stale `status:reviewed` label — re-review needed]   ← if the label is present
> [ · note: behind base by N — rebase before merge]   ← if stale
>
> Proceed? (**y** / **edit** a reply / **back** to triage)

On **y**:
1. **Push** the branch: `git push [remote] [head-ref]` (a normal fast-forward push — never `--force`).
2. **Reply to threads** via `mcp__github`:
   - Each **fixed** finding with a GitHub `thread` → post a reply (`Fixed in [sha] — [what changed]`) and resolve the thread if the API exposes it.
   - Each **skipped** finding with a GitHub `thread` → post a reply explaining it was intentionally skipped (the user's reason from triage).
   - Fixed findings with **no** thread → no GitHub reply; they're captured in Zone 2.
3. **Stale review label.** If a `status:reviewed` label is present, remove it via `mcp__github` — the new commits invalidate the prior clean review, and `run`'s merge gate treats that label as approval. The PR now needs a fresh review pass. (Do **not** dismiss the reviewer's `CHANGES_REQUESTED` review — re-approval is the reviewer's call.)
4. **Zone 2.** If `context.md` exists, append one entry (`$NOW`, author `pr-fix`): fixes applied (finding ids → shas), skipped (ids + reason), the pushed head sha, and any pre-existing-failure decisions.

## Phase: teardown

Every exit — clean finish, no-findings, lock refusal, abort, or error — routes through teardown. Each step is **conditional on having done the matching setup**, so a partial run cleans up exactly what it changed and nothing it didn't:
- **If the branch was switched** (checkout happened in `sync`) → `git checkout $PRIOR_BRANCH` to return the user where they started.
- **If a stash was created** → `git stash pop` it.
- **If the lock was acquired** → release it (delete `.lock`). Do not delete a lock you never took (e.g. the lock-refused path — it belongs to the live `run`).

Report:

> ✅ pr-fix [repo]#[pr] — [k] fixed, [m] skipped, pushed [sha].
> [behind base by N — rebase before merge.]
> [status:reviewed removed — re-review needed.]
> Next: `/devloop:pr-review [pr]` to re-review, then `/devloop:run [N]` to merge.

---

## Exception handling

- **Dirty working tree** — gate on stash at sync; never check out over uncommitted work.
- **Live run lock** — refuse and stop (pop stash if created); the user finishes or aborts the run first.
- **Agent returns `ERROR:`** — surface it; offer **retry** / **skip the finding** / **abort** (abort still runs teardown).
- **`coder` can't reach green after 3 attempts** — escalate per the fix loop.
- **`coder` returns `MISSING:`** — ask for the command, write it to the profile, re-invoke; not a failed attempt.
- **No findings** — report and stop cleanly (with teardown).
- **GitHub MCP failure on push/reply** — the commits may already be pushed; report precisely what landed and what didn't, and retry the replies once on the user's go-ahead. Zone 2 records the fixes, so replies can be retried without re-fixing.
- **Crash mid-run** — commits are durable and the lock's stale PID is auto-cleared next time; re-invoking re-reads findings and continues. Resolve any leftover stash manually if a crash happened between stash and pop (the report names the stash).
