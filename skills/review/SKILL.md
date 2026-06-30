---
description: Close out a sprint. Reconciles every sprint issue (shipped / carried over / dropped / closed), writes a retrospective to sprint-N-review.md, optionally tags a release, closes the GitHub milestone, and marks the sprint completed in the master plan. Conversational — pauses at every human gate and never closes the milestone while a run is still active. Pass a sprint number to close a specific sprint (e.g. /devloop:review 3).
---

You are running **devloop:review**. This is the end-of-sprint ceremony: it reconciles the sprint's issues, captures a retrospective, and formally closes the sprint (milestone + master-plan status).

**Conversational.** Pause at every human gate and wait for explicit confirmation. Closing a milestone and relabelling/closing issues are outward-facing GitHub actions — confirm before each batch.

**Scope.** review owns the **sprint and milestone**: the fate of each issue's milestone membership, the retro document, the git tag, the milestone state, and the master-plan `Status`. It does **not** execute work, touch branches, or delete run state/locks — those belong to `run` and `abort`. Because `run` carries every issue shape (code, design, scaffold, manual) to closed, review assumes a healthy sprint is already fully closed; its job is to reconcile whatever is left and seal the sprint.

User may have passed a sprint identifier via `$ARGUMENTS` (e.g. `3`, `sprint-3`, `s3`). Parse any of these to a sprint number `$SPRINT_N`. If `$ARGUMENTS` is non-empty but has no recognisable number, warn and fall through to auto-detect:

> Argument "[ARGUMENTS]" doesn't look like a sprint number — resolving the active sprint instead.

---

## Step 0 — Resolve sprint and repo

**Sprint.** If `$ARGUMENTS` contains a number, use it as `$SPRINT_N`. Otherwise:
- Read `.context/sprints/master-plan.md` if it exists. Find the entry with `- **Status:** active` and use its sprint number. If multiple are active, use the highest and note it. If none is active, use the highest sprint number in the Sprint Map.
- If the master plan does not exist, scan `.context/sprints/` for `sprint-N.md` and use the highest N.

If no sprint can be resolved:

> No sprint files found. Run `/devloop:plan` to start a sprint before there's anything to review.

Stop.

**Read the sprint file** `.context/sprints/sprint-[N].md`. If it does not exist:

> Sprint [N] file not found at `.context/sprints/sprint-[N].md`. Nothing to review — check the sprint number.

Stop. Extract `$SPRINT_GOAL`, `$MILESTONE_NUMBER`, `$REPO`, `$CREATED`, and the ordered issue checklist (strip any trailing `⚠ unassigned`).

**Already completed?** If the master plan marks this sprint `- **Status:** completed`:

> Sprint [N] is already marked completed in the master plan. I can still regenerate the retrospective and re-check the milestone, but I won't re-close anything. Continue? (y/n)

On **n**, stop. On **y**, proceed but treat the close actions in Step 5 as idempotent (skip what's already done).

**Repo reachability.** Verify `$REPO` exists via GitHub MCP. If it fails:

> Could not reach `$REPO` — [error]. GitHub reconciliation and milestone close need it. Check the repo name and your token, then retry — or continue with **local-only** review (retro + master-plan status, no GitHub changes)? (retry / local)

On **local**, set `$GITHUB_UNAVAILABLE = true` and skip every GitHub/milestone call later, noting the omission in the report.

---

## Step 1 — Preconditions and snapshot

**Active-run guard.** Read `.context/sprints/state/.lock` if it exists. Read its `holder` field (a missing field predates it — treat as `run`) and determine PID liveness with `kill -0 <pid> 2>/dev/null` (exit 0 = alive).

- **Live PID, `holder: pr-fix`** — a pr-fix is editing a PR's tree. It doesn't execute a sprint issue, so it doesn't block the close, but a PR is mid-edit: note it (`⚙ pr-fix is active on PR #[pr] — proceeding; review won't touch it. Its fixes won't be reflected until it pushes.`) and continue.
- **Live PID, `holder: run`, locked issue is in this sprint** — a run is mid-flight:

  > ⚙ `run` is active on #[N] (PID alive). A sprint can't be closed while an issue is still executing. Finish that run, or `/devloop:abort` it, then re-run `/devloop:review`.

  Stop.
- **Live PID, `holder: run`, locked issue is in a different sprint** — note it (`⚙ run is active on #[N] of another sprint — proceeding; this review won't touch it.`) and continue.
- **Stale lock** (dead PID) — note it: `⚠ Found a stale lock (`[holder]`[, issue/PR #N]) — the next /devloop:run clears it; review leaves it untouched.` Continue.
- **Absent** — continue.

**Gather GitHub state** (skip all of this if `$GITHUB_UNAVAILABLE`):
- For each sprint issue number, fetch its state (`open` / `closed`) via GitHub MCP.
- List the repo's PRs (paginate past 100) and map each sprint issue to a merged or open PR the way `status` does — head branch `feat/issue-N-` or `fix/issue-N-` (N anchored by a trailing `-` so `issue-4-` ≠ `issue-42-`), or a `Closes #N` / `Fixes #N` body keyword (N anchored by a non-digit/end). Record `$PR_MAP[N]`.
- Fetch milestone `$MILESTONE_NUMBER` via GitHub MCP for `$MILESTONE_DUE`, `$MILESTONE_OPEN`, `$MILESTONE_CLOSED`, and its current `state` (`open`/`closed`).

**Read the baseline.** Read `.context/devloop-baseline.md` if it exists — the accepted-failing allowlist. Collect entries whose `tracking:` issue is still open (carry-over debt) and any `added-by: issue #X` where X is in this sprint (debt this sprint introduced).

**Classify each issue** using the first matching rule:

| Priority | Condition | Class |
|---|---|---|
| 1 | GitHub state `closed` | **shipped** |
| 2 | Checkbox `[x]`, GitHub `open` | **done ⚠** (merged without a `closes` keyword, or closed-issue drift) |
| 3 | Checkbox `[x]`, GitHub unavailable | **shipped** (local belief) |
| 4 | Checkbox `[ ]`, GitHub `open` | **unfinished** |

Present a read-only snapshot (no gate yet):

> ## Sprint [N] review — _"[SPRINT_GOAL]"_
>
> Repo: [owner/repo] · Milestone #[number] ([MILESTONE_CLOSED] closed / [MILESTONE_OPEN] open · due [MILESTONE_DUE]) · Created [date]
>
> | # | Title | Area | Class | PR |
> |---|-------|------|-------|----|
> | #44 | Add session persistence | infra | shipped | #10 |
> | #43 | Add JWT middleware | api | shipped | #12 |
> | #42 | Add login page | web | unfinished | — |
>
> **[K] shipped · [M] unfinished · [D] done ⚠**  ([X] of [T] issues complete)
> Known-failing debt still open: [count] ([list tracking issues] — or "none")

If every issue is **shipped** and there are no **done ⚠** rows, say so and skip Step 2:

> All [T] issues shipped — nothing to reconcile.

---

## Step 2 — Reconcile issues *(human gate)*

Only runs if there are **unfinished** or **done ⚠** issues. Decide the fate of each before sealing the sprint.

**done ⚠** — local says done, GitHub says open. Almost always a PR merged without a `closes #N` keyword. Default disposition: **close on GitHub**.

**unfinished** — open and not done. Offer a disposition per issue:
- **carry over** — keep open; **remove it from this milestone** so the next sprint can select it (the `issue-selector` only sees issues with no milestone).
- **backlog** — relabel `type:backlog` and remove it from this milestone, sending it back to the backlog pool for `/devloop:plan` to re-triage.
- **close** — close on GitHub as out of scope, with a comment.
- **keep in milestone** — leave it open and assigned (it will show as an open issue under a closed milestone). Allowed but discouraged; note it in the retro.

Present the gate with proposed defaults:

> **Reconcile Sprint [N] — [n] issue(s) need a decision**
>
> | # | Title | Class | Proposed |
> |---|-------|-------|----------|
> | #42 | Add login page | unfinished | carry over |
> | #45 | Password reset flow | unfinished | carry over |
> | #51 | Update readme | unfinished | backlog |
> | #44 | Add session persistence | done ⚠ | close on GitHub |
>
> Decide each: **carry over** / **backlog** / **close** / **keep** (done ⚠ → **close** / **keep open**).
> Reply with bulk or per-issue decisions (e.g. "carry over all, backlog #51"):

Wait for the response. Accept bulk and per-issue decisions in any combination. Re-present the resolved dispositions once for a final confirmation:

> Dispositions: #42 carry over · #45 carry over · #51 → backlog · #44 close. Apply these? (y / adjust)

**Apply** on confirmation (skip GitHub calls if `$GITHUB_UNAVAILABLE`, recording them as deferred in the report):
- **carry over** — clear the issue's milestone via GitHub MCP (set milestone to none). Leave the checkbox unticked.
- **backlog** — add the `type:backlog` label and clear the milestone via GitHub MCP.
- **close** — close via GitHub MCP with a comment: `Closed at Sprint [N] review — [out of scope / superseded].` For a **done ⚠** issue, the comment is `Closing — delivered in PR #[pr] (merged without a closes keyword).`
- **keep** — no GitHub call.

If any call fails:

> Failed to [action] #[N]: [error]. Retry? (y/n) — if no, it's left as-is and noted in the report.

Wait for the response; retry once on **y**, otherwise leave it and note it.

Carried-over and backlog issues are **not** ticked in the sprint file — they remain genuinely unfinished. The sprint file is a historical record of this sprint; review does not rewrite its checkboxes (only `run` ticks a box on completion).

---

## Step 3 — Retrospective *(human gate)*

Draft `.context/sprints/sprint-[N]-review.md`. Derive a script timestamp for the close date:

```
node -e "console.log(new Date().toISOString().slice(0,10))"
```

Use it as `$CLOSED_DATE`. Build the draft from observable data — shipped issues and their PRs, the reconciliation dispositions just made, and the open known-failing debt — then invite the user to add the qualitative reflection that only they have.

```markdown
# Sprint [N] Review

**Goal:** [SPRINT_GOAL]
**Milestone:** #[milestone_number]
**Repo:** [owner/repo]
**Period:** [CREATED] → [CLOSED_DATE]
**Outcome:** [K] of [T] issues shipped

## Shipped
- #[N] — [title] (PR #[pr])      ← one line per shipped issue; "(no PR)" for design/scaffold/manual closes

## Carried over / deferred
- #[N] — [title] → carried to next sprint
- #[N] — [title] → returned to backlog
- #[N] — [title] → closed (out of scope)
(— "None" if the sprint shipped clean —)

## Known-failing debt
- [check] [test] — tracking #[issue]    ← baseline entries still open
(— "None" —)

## Retrospective
**What went well:**
- [drafted from signals — e.g. "all api issues shipped", or leave a prompt for the user]

**What to improve:**
- [drafted from signals — e.g. "2 issues carried over; sprint may have been over-scoped", "1 known-failing test still open"]

**Notes:**
- [anything the user wants to record]
```

Present the draft and invite edits:

> **Sprint [N] retrospective — draft**
>
> [render the draft]
>
> The **Shipped / Carried over / Known-failing** sections are filled from the data. Add or refine the **What went well / improve / Notes** — what should the next sprint carry forward? Confirm to write, or tell me what to change:

Wait for the response. Apply edits, re-present if substantially changed, then write `.context/sprints/sprint-[N]-review.md` on confirmation:

> Retrospective written to `.context/sprints/sprint-[N]-review.md`.

---

## Step 4 — Tag a release *(optional human gate)*

Offer a git tag to mark the sprint boundary. This is optional — many sprints don't cut a release.

> Tag this sprint in git? A tag marks the merge point so you can diff sprint-to-sprint. (tag name, e.g. `sprint-[N]` or `v0.[N].0` — or `skip`)

On **skip**, continue. Otherwise:
- Confirm the tag name and an optional message, then create an **annotated** tag on the current `HEAD` of the base branch: `git tag -a <name> -m "<message>"`. Do not push automatically.
- Ask whether to push it:

  > Tag `<name>` created locally. Push it to `origin`? (y/n)

  On **y**, `git push origin <name>`. On **n**, leave it local and note it.

If the tag already exists, report it and ask for a different name or to reuse it. If `HEAD` is not on the base branch, note which commit will be tagged before creating it.

---

## Step 5 — Close the sprint

The sealing actions. Re-confirm before the milestone close, since it's the irreversible-ish, outward-facing step:

> **Close Sprint [N]?**
>
> - Milestone #[milestone_number] → **closed** on GitHub
> - Master plan → Sprint [N] `Status: completed`
> [- ⚠ [n] issue(s) are still open under this milestone (kept) — they'll sit under a closed milestone]   ← only if any "keep" disposition was chosen
>
> Confirm to close the sprint (y / n):

On **n**, stop here — the retro and tag are already saved; the sprint stays open. On **y**:

1. **Close the milestone** via the **devloop milestones MCP** `close_milestone` (`owner`, `repo`, `milestone_number`). Skip if `$GITHUB_UNAVAILABLE` or the milestone is already closed (note it). If it fails:

   > Failed to close milestone #[milestone_number]: [error]. Retry? (y/n) — if no, the master plan is still updated and you can close the milestone on GitHub manually.

   Retry once on **y**.

2. **Mark the master plan completed.** In `.context/sprints/master-plan.md`, find the `### Sprint [N]` entry and set its `- **Status:** completed`. Preserve the theme, `Goal:`, and `Sprint file:` lines verbatim. If the entry is missing (master plan drifted), append a minimal `### Sprint [N]` entry with `Status: completed` and the `Sprint file:` line.

3. **Auto-clean resolved baseline.** For any `.context/devloop-baseline.md` entry whose `tracking:` issue is now **closed**, offer to remove it:

   > These known-failing entries track issues that are now closed: [list]. Remove them from the baseline? (y/n)

   On **y**, drop those entries. Leave entries with still-open tracking issues — they're real carry-over debt and already appear in the retro.

---

## Completion report

> **✅ Sprint [N] closed** — _"[SPRINT_GOAL]"_
>
> Shipped [K] of [T] · [carried over / backlog / closed counts]   ← omit zero counts
> Milestone #[milestone_number]: [closed / already closed / ⚠ not closed — see above]
> Retrospective: `.context/sprints/sprint-[N]-review.md`
> [Tag: `<name>` [pushed / local]]   ← omit if skipped
>
> [If GitHub was unavailable: ⚠ GitHub changes were skipped — close milestone #[number] and reconcile [issues] manually.]

Then suggest the next step:
- If carried-over or backlog issues exist → `Next: /devloop:plan to scope Sprint [N+1] (your carried-over issues are back in the pool).`
- Otherwise → `Next: /devloop:roadmap to set the next sprint's theme, then /devloop:plan to scope it.`

---

## Exception handling

- **GitHub MCP failure** (issue fetch, relabel, close, milestone close) — report it; offer **retry once** or to continue and note the skipped action in the report. A milestone-close failure never blocks the master-plan update — the local record of completion still stands.
- **Active run on this sprint** — stop in Step 1; a sprint can't be sealed while an issue is executing.
- **Master-plan entry missing for Sprint [N]** — append a minimal `### Sprint [N]` entry with `Status: completed` rather than failing.
- **Tag already exists / detached HEAD** — surface it in Step 4 and ask for a new name or which commit to tag; never force-move an existing tag.
- **Re-running on an already-completed sprint** — allowed; regenerate the retro and re-check the milestone, but skip actions already done (idempotent close).
