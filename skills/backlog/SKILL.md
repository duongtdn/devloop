---
description: Distill the current brainstorm conversation into GitHub backlog items. Reviews what was discussed, proposes candidate issues, lets the user confirm or edit them, then creates the approved items with the type:backlog label. Conversational — pauses at every step for user confirmation. Never auto-triggers; must be invoked explicitly.
---

You are running **devloop:backlog**. This skill is fully conversational — pause at every human gate and wait for explicit confirmation before moving to the next step.

User may have passed a focus hint via `$ARGUMENTS` (text typed after `/devloop:backlog`). If present, treat it as a filter: only surface backlog candidates relevant to that topic or area.

---

## Step 0 — Detect repo

Run:

```bash
git remote -v 2>/dev/null | grep -i github.com | head -5
```

Parse each line for SSH form `git@github.com:owner/repo.git` or HTTPS form `https://github.com/owner/repo.git`. Prefer `origin` if it appears; otherwise use the first GitHub remote found. Strip the `.git` suffix and extract `owner/repo`.

**If a GitHub remote is found**, present it for confirmation:

> Repo detected as **owner/repo** (from remote `[remote-name]`) — confirm or enter the correct value (format: `owner/repo`):

**If no GitHub remote is found**, check whether any remotes exist at all:

```bash
git remote -v 2>/dev/null | head -5
```

- If remotes exist but none point to GitHub:

  > No GitHub remote detected — found remotes pointing to `[other host]`. This plugin requires a GitHub repo.
  >
  > If your GitHub repo is at a different remote, enter it now (format: `owner/repo`), or press enter to exit:

  If the user presses enter with no input, stop.

- If no remotes exist at all:

  > No git remotes found. Enter the GitHub repo to use (format: `owner/repo`), or press enter to exit:

  If the user presses enter with no input, stop.

**Validate manual input.** If the user enters a value (from any path above), verify it matches `owner/repo` format exactly:
- Must contain exactly one `/`
- Both `owner` and `repo` parts must be non-empty
- Must not start with `http`, `git@`, or contain `.git`

If invalid, say so and ask again. Repeat until valid or the user presses enter to exit.

**Reachability check.** Once `$REPO` is confirmed, verify the repo exists and is accessible via GitHub MCP (fetch repo metadata). If it fails:

> Could not reach `owner/repo` on GitHub — got: [error]. Check the repo name and your GitHub token, then try again (or enter a different repo):

Wait for correction. Repeat the reachability check. Do not proceed until confirmed reachable.

Ensure the `type:backlog` label exists in `$REPO` — fetch the label via GitHub MCP. If it does not exist, create it now (color `#e4e669`, no description needed) without asking. Report:

> Label `type:backlog` created in `$REPO`.

---

## Step 1 — Extract candidates

Review the entire conversation that preceded this skill invocation. Your goal is to surface every concrete idea, feature request, problem statement, open question, or decision point that came up — things that could become actionable work items, even if they were mentioned briefly or left unresolved.

Do not cherry-pick only the most prominent topics. Include anything that was raised and not explicitly dismissed by the user during the conversation.

If `$ARGUMENTS` is non-empty, apply it as a filter: only extract candidates that relate to the specified topic or area.

**For each candidate, extract:**
- **Title** — a short, action-oriented phrase (4–8 words). Start with a verb where natural (e.g. "Add", "Fix", "Explore", "Decide", "Refactor").
- **Hint** — a single word indicating the likely nature of the item: `feature`, `bug`, `chore`, `question`, or `decision`.
- **Notes** — one sentence summarizing what was said about this item in the conversation.

**Deduplication.** If two candidates cover the same underlying idea, merge them into one. Use the more specific or actionable framing as the title; combine the notes.

If no candidates are found at all:

> No actionable items found in this conversation — nothing to add to the backlog.

Stop.

---

## Step 2 — Present and confirm

**Human gate — present the candidates and wait for approval:**

> **Backlog candidates from this conversation** _(N items)_
>
> | # | Title | Hint | Notes |
> |---|-------|------|-------|
> | 1 | Add rate limiting to API | feature | Came up when discussing auth — need to cap login attempts |
> | 2 | Decide on token expiry policy | decision | Unresolved: short-lived tokens vs. refresh token flow |
> | 3 | Fix flaky email send in CI | bug | Mentioned as intermittent; not investigated yet |
>
> For each row: **keep** (default), **edit**, or **drop**.
> You can also **add** items not listed above.
>
> Reply with your changes (e.g. "drop 2, edit 1 title to 'Add login rate limiting'") or confirm all as-is:

Wait for the user's response.

**Process feedback:**
- **Confirm / "looks good" / no changes** — proceed with all rows as shown.
- **Drop N** — remove that row.
- **Edit N** — apply the stated change (title, hint, or notes).
- **Add [text]** — append a new row; infer title, hint, and notes from the text; assign the next available row number.
- **Bulk changes** (e.g. "drop all questions") — apply across matching rows.

After applying changes, if anything was changed, show the updated table and ask for final confirmation:

> Updated list:
>
> | # | Title | Hint | Notes |
> |---|-------|------|-------|
> | 1 | Add login rate limiting | feature | Came up when discussing auth — need to cap login attempts |
> | 3 | Fix flaky email send in CI | bug | Mentioned as intermittent; not investigated yet |
>
> Confirm to create these as backlog issues, or keep editing:

This loop repeats — apply any further changes, show the updated table again, and wait for confirmation — until the user explicitly confirms. Only then proceed to Step 3.

If the user drops everything or the final list is empty:

> Nothing to create — exiting.

Stop.

---

## Step 3 — Review and create backlog issues

Work through the confirmed items strictly one at a time. Do not move to the next item until the current one is approved and created.

**For each item [X of N]:**

**Draft the body.** Go back to the conversation and write a fuller description for this item — 3–6 sentences. Cover:
- What the idea or problem is
- Why it came up or why it matters (context from the conversation)
- Any open questions or constraints mentioned

Do not copy the one-liner from the Notes column verbatim — expand it using what was actually said.

Append a footer line:

```
---
*Captured from conversation on [ISO8601 date, date only] via `/devloop:backlog`.*
```

**Human gate — present the full draft and wait for approval:**

> **Issue [X of N]: [title]** (`[hint]`)
>
> ---
> [full drafted body rendered as markdown]
> ---
>
> Approve, edit, or drop:

Wait for the user's response:
- **Approve / "looks good"** — create the issue immediately.
- **Edit [instructions]** — apply the changes, show the updated body, wait for re-approval.
- **Drop** — skip this item; note it in the completion report.

**Create.** On approval, create the issue via GitHub MCP:
- **Title:** the confirmed title
- **Labels:** `["type:backlog"]`
- **Body:** the approved body text

If creation fails:

> Failed to create "[title]": [error]. Retry? (y/n)

Wait for response. On yes, retry once. On no, skip and note in the completion report.

After each successful creation, announce and continue:

> Created #[N] — moving to next item. ← use this when X < N
> Created #[N] — all items processed. ← use this when X = N

---

## Completion report

When all items are processed, report:

> **Backlog updated** — [N] issues created in `$REPO`.
>
> | GitHub issue | Title |
> |-------------|-------|
> | #[N] | Add login rate limiting |
> | #[N] | Fix flaky email send in CI |
>
> These will appear in `/devloop:plan` backlog triage when you start the next sprint.

If any items were dropped or skipped due to creation failure, list them:

> Dropped: "[title]"
> Skipped (creation failed): "[title]"
