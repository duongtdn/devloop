---
description: Cleanly stop an in-progress devloop:run for one issue and decide what happens to the work left behind. Releases the lock and gives you control over the branch (delete / keep / park as a draft PR) and the run state (delete for a fresh restart, or keep to resume later). Conversational — pauses for confirmation before anything destructive. Does not close the issue, tick the sprint checkbox, or touch the milestone. Pass an issue number to target a specific run (e.g. /devloop:abort 42).
---

You are running **devloop:abort**. This is the escape hatch for `devloop:run`: a conversational skill that cleanly tears down an in-progress execution and hands control of the leftover artifacts back to the user.

`run` owns three things while a run is active — a global `.lock`, a per-issue `state/issue-N.md`, and a working branch (possibly with commits, possibly pushed, possibly with a PR). abort tears those down on the user's terms.

**Scope.** abort deals only with **execution artifacts**. It explicitly does **not** close the GitHub issue, tick the sprint checkbox, or change the issue's milestone — those belong to `run`, `review`, and `plan`. Dropping an issue from the sprint is a re-planning decision: tell the user to use `/devloop:plan` for that.

**Conversational.** Pause at every human gate. Re-present until the user explicitly chooses. Confirm before any destructive action (branch delete, remote delete, state-file delete).

User may have passed an issue number via `$ARGUMENTS` (e.g. `42`, `#42`). Parse it to `$ISSUE` if present; otherwise `$ISSUE` is unset.

---

## Step 0 — Resolve the working repo

Branch and PR operations act on the current working repo. Resolve `$REPO` (`owner/name`) from the git remote:

```
git remote get-url origin
```

Parse `owner/name` from the URL (strip a trailing `.git`; handle both `git@github.com:owner/name.git` and `https://github.com/owner/name.git`). If there is no `origin` remote, set `$REPO = unknown` — local branch and state cleanup still work; only remote-branch delete, push, and draft-PR creation need `$REPO`, and abort will skip those with a note if it is unknown.

---

## Step 1 — Identify the target run

Resolve which in-progress run to abort:

| Invocation | Resolution |
|---|---|
| `abort N` | Target `$ISSUE = N`. Read `.context/sprints/state/issue-N.md`. |
| `abort` (no arg), `.lock` present | Read `.context/sprints/state/.lock` for the active issue → `$ISSUE`. Read its state file. |
| `abort` (no arg), no `.lock`, exactly one `state/issue-*.md` | Target that issue. |
| `abort` (no arg), no `.lock`, multiple `state/issue-*.md` | List them; ask which to abort. |
| `abort` (no arg), no `.lock`, no state files | Report "no in-progress run found" and exit. |

If nothing resolves to a target (no state file **and** no lock):

> No in-progress run found — there's nothing to abort. (`/devloop:status` shows sprint state; `/devloop:run` starts work.)

Stop.

**pr-fix lock guard.** Before anything else, if a `.lock` exists read its `holder` field (a missing field predates it — treat as `run`). If `holder` is `pr-fix`, this lock belongs to a `/devloop:pr-fix` session, not a run — abort is the wrong tool for it. Check its PID with `kill -0 <pid>`:

> The lock is held by **pr-fix** (PR #[pr]), not a run.
> - **alive:** `⚠ pr-fix is active on PR #[pr] — let it finish, or stop that session; it releases its own lock on exit. abort won't touch it.` → exit.
> - **stale:** `Found a stale pr-fix lock (PR #[pr]). Clear it? (y/n)` → on y, delete `.lock` and exit; on n, exit.

abort never tears down a live pr-fix session. Only proceed into the run-teardown flow below when the holder is `run`.

**Lock without a state file.** If a `run` `.lock` exists for `$ISSUE` but its `state/issue-N.md` is missing (corrupted or partially cleaned), there's nothing to summarize and no branch decision to make — skip Steps 2–3, report that only a lock was found, and go straight to Step 4 to release it.

**Live-PID warning.** If a `run` `.lock` exists, read its issue number `$LOCK_ISSUE` (from `issue:`) and PID `$LOCK_PID`, and check liveness with `kill -0 $LOCK_PID 2>/dev/null` (exit 0 = alive). If the PID is **alive**, warn before doing anything:

> ⚠ A `run` process holding the lock for #[LOCK_ISSUE] appears to be **alive** (PID [pid]). Aborting now tears down its files underneath it. Make sure that run is stopped (it's likely in another terminal) before continuing.
>
> Continue with the abort? (y/n)

On **n**, exit without changes. On **y**, proceed. A dead PID needs no warning — abort will clear the stale lock as part of cleanup. (When `$LOCK_ISSUE` differs from the issue being aborted, see the last bullet in [Exception handling](#exception-handling) before releasing the lock.)

---

## Step 2 — Read state and build the summary

From the target state file (`state/issue-N.md`) read: `phase`, `phase_step`, `task_index`, `workflow`, `branch`, `base`, `pr`. Treat `-` as "not set".

Gather the branch facts (only if `branch` is set, i.e. not `-`):

- **Local branch exists?** `git rev-parse --verify --quiet refs/heads/<branch>` (exit 0 = exists).
- **Commits ahead of base** (if both exist): `git rev-list --count <base>..<branch>`.
- **Pushed?** `git rev-parse --verify --quiet refs/remotes/origin/<branch>` (exit 0 = a remote branch exists). If unsure, treat as not pushed.
- **Uncommitted changes** on the current tree: `git status --porcelain` (non-empty = dirty).

Determine PR state: if `pr` is set, fetch it via the GitHub MCP to confirm it is open and whether it is a draft; if the fetch fails, report the recorded number with state `unknown`. If `pr` is `-`, treat as "no PR".

Present the summary (read-only — no gate yet):

> **Aborting #[N] — [title]  ([workflow])**

| | |
|---|---|
| Stopped at | phase `[phase]`[ · step `[phase_step]`][ · task [task_index+1]] |
| Branch | `[branch]` — [local exists] · [K] commit(s) ahead of `[base]` · [pushed / not pushed] |
| PR | [#pr (open) / #pr (draft) / none] |
| Working tree | [clean / ⚠ has uncommitted changes] |

> I'll now ask what to do with the branch and the run state. I will **not** close the issue, change the sprint checkbox, or touch the milestone.

Fetch the issue title via the GitHub MCP for the heading; fall back to the branch slug if unavailable. If `branch` is `-` (aborted before a branch was ever created — e.g. during context or plan), say so and **skip Step 3** entirely (nothing to decide), going straight to Step 4.

---

## Step 3 — Branch decision *(human gate)*

This step only **captures and confirms** the choice — execution happens in Step 4. Present three options; re-present until the user picks one; confirm before the destructive one.

> **What should happen to branch `[branch]`?**
>
> - **delete** — remove the local branch[ and the remote branch]. ⚠ [K] commit(s) and any uncommitted work on it are lost permanently.
> - **keep** — leave the branch as-is. You can return to it manually or resume with `/devloop:run [N]`.
> - **draft-pr** — push the branch[ (already pushed)] and open a **draft** PR titled `[WIP] #[N] [title]`, so the work is preserved and visible.

**delete** — require explicit typed confirmation:

> This permanently deletes `[branch]` ([K] commits[, including uncommitted changes]). Type `delete` to confirm:

If a PR is open on this branch, add that deleting the branch will **close the PR**, and require the same confirmation.

**draft-pr** — if `$REPO` is `unknown` (no remote), tell the user a push/PR isn't possible and fall back to **keep**.

Record the confirmed branch action; Step 4 carries it out.

---

## Step 4 — Cleanup

**First, capture the branch's areas** — `git diff --name-only <base>...<branch>`, collapsed to directory globs — and hold them for step 4. A **delete** decision destroys the only thing that could answer that question, and after it the areas are unrecoverable; capture before the delete, not after, for the same reason S2 of `run` captures a stale lock's `issue:` before removing the file.

Then carry out the recorded decisions in this order, so the only forced branch switch is the one delete genuinely requires and the lock is always released last:

1. **Execute the branch decision** from Step 3:
   - **keep** — do nothing; leave the user on their current branch.
   - **delete** — the branch can't be deleted while checked out, so first leave it: if it's the current branch, `git switch <base>` — and because the user accepted losing uncommitted work, use `git switch --discard-changes <base>` when the tree is dirty. Then `git branch -D <branch>`. If it was pushed and `$REPO` is known, also delete the remote branch via the GitHub MCP (delete the `heads/<branch>` ref, or `git push origin --delete <branch>`).
   - **draft-pr** — no branch switch needed. If a PR already exists for this branch, offer to convert it to draft via the GitHub MCP (leave it as-is if already a draft) — don't create a second PR. Otherwise push the branch (`git push -u origin <branch>`) if not already pushed, then create a **draft** PR via the GitHub MCP — base `[base]`, head `[branch]`, title `[WIP] #[N] [title]`, body noting the run was aborted at phase `[phase]` and the work is parked for later. Report the PR number.
2. **State decision** *(human gate):*

   > **What about the run state for #[N]?**
   >
   > - **delete** — remove `state/issue-N.md`. The next `/devloop:run [N]` starts this issue **fresh from the top**.
   > - **keep** — leave the state file. The issue shows as `stale` in `/devloop:status`; the next `/devloop:run [N]` **resumes** from phase `[phase]`.

   On **delete**, remove `.context/sprints/state/issue-N.md`. On **keep**, leave it and append a `## Log` line recording the abort with a script-derived timestamp (`node -e "console.log(new Date().toISOString())"`) so the resume point is dated, e.g. `- <ISO> aborted by user at phase [phase]`.

3. **Release the lock.** Delete `.context/sprints/state/.lock` if it exists and it belongs to the issue being aborted (or is stale) — without it, `run` refuses to start (`⚙ run is already in progress`). The one exception: a **live** lock for a *different* issue belongs to another active run — leave it (see [Exception handling](#exception-handling)).
4. **Append the journal line.** One line to `.context/devloop-journal.md`, per `skills/tinker/journal-spec.md`:

   ```
   - YYYY-MM-DD · abort #[N] · abandoned · `<areas>` · [what was being attempted, and how far it got before it was torn down] → `sprints/work/issue-[N]/`
   ```

   **This is the most valuable line the journal ever gets, and it is the one most likely to be skipped** — an aborted run leaves no merge commit, no closed issue, and (on a **delete** state decision, with the branch deleted) very nearly no trace at all. *Somebody already tried this and it did not work* is otherwise the single most expensive fact in a project to rediscover, and six months later the next attempt starts from zero. Write it even when the abort was routine.

   Restated because this is the write site: append with `cat >>`, **never `Edit`**; script-derive the date (`node -e "console.log(new Date().toISOString().slice(0,10))"`); take the areas from `git diff --name-only $base...<branch>` **before** any branch delete in step 1 — mechanically, never composed — and where the branch is already gone or never had commits, write `—` rather than a guess.
5. **Leave `work/issue-N/` untouched** — its context/plan/design artifacts are harmless and useful for reference.

---

## Step 5 — Confirm

Print a brief summary of what was done and the right next step:

> **✅ Aborted #[N].**
>
> - Branch `[branch]`: [deleted (local[ + remote]) / kept / parked as draft PR #pr]
> - Run state: [deleted — next run starts fresh / kept — next run resumes from phase [phase]]
> - Lock released.
>
> The issue is untouched on GitHub and still in its sprint.

Then add exactly one next-step line based on the state decision:
- state **kept** → `Resume it any time: /devloop:run [N].`
- state **deleted** → `Restart it from the top: /devloop:run [N].`

And always offer the re-planning path:
- `Want it out of the sprint instead? Run /devloop:plan to re-triage.`

---

## Exception handling

- **GitHub MCP failure** (PR fetch, remote-branch delete, draft-PR create) — report it; offer to retry once or to fall back to a local-only action (e.g. **keep** the branch, or delete only the local branch). Never let a remote failure block the lock release in Step 4.
- **Can't switch to `[base]` for a delete** (base ref missing locally, detached HEAD) — surface the error; since the checked-out branch can't be deleted, fall back to **keep** with a note, then continue with state and lock cleanup.
- **Lock for a different issue.** When `$LOCK_ISSUE` differs from the issue being aborted: if the lock is stale (dead PID), clear it as normal. If it's **live**, the abort and the lock are about different runs — clean up this issue's state file but **leave the lock in place** (it belongs to the other active run); say so in the summary instead of claiming the lock was released.
