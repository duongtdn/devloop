# Field report — no MCP operation can clear an issue's milestone, so `review` and `replan` fall back to `gh`

**Date:** 2026-07-13
**Reporter:** outer loop (`/devloop:review` → `/devloop:replan`), Stemolly Sprint 1
**Severity:** medium — two skills instruct an operation that does not exist; the workaround depends on an undeclared external dependency
**Fix cost:** two lines in `bin/github-extras.js` (devloop's own code)

---

## Summary

`review` and `replan` both tell the model to **clear an issue's milestone** — it is how an unfinished issue is carried over, sent to backlog, or dropped from a sprint. **No tool in either MCP server can do it.**

The model is therefore forced to shell out to `gh issue edit --remove-milestone`, which no skill document mentions and which requires a dependency devloop otherwise never needs. On a machine where `gh` is absent, unauthenticated, or blocked by the sandbox, **both operations fail with no documented fallback**.

Hit for real while dropping issue #22 out of Sprint 1.

---

## The instructions that can't be followed

**`skills/review/SKILL.md`, Step 2 (Reconcile issues) — Apply:**

> - **carry over** — clear the issue's milestone via GitHub MCP (set milestone to none). Leave the checkbox unticked.
> - **backlog** — add the `type:backlog` label and clear the milestone via GitHub MCP.

**`skills/replan/SKILL.md`, Operation: drop:**

> - **to pool** (default) — clear its milestone via GitHub MCP; it returns to the sprint-ready pool for a later `plan`.
> - **to backlog** — add `type:backlog` and clear the milestone; `plan`'s triage will re-assess it.

Three of the four dispositions in `review`'s reconcile gate, and two of the three in `replan`'s drop, depend on "clear the milestone via GitHub MCP." That phrase names a capability the toolchain does not have.

This also matters more than it looks: **clearing the milestone is the mechanism, not a detail.** The `issue-selector` agent only sees issues with *no milestone* — so an issue whose milestone was never cleared is invisible to the next `/devloop:plan`, and silently falls out of the process. A carry-over that fails to clear the milestone doesn't carry over at all; it disappears.

---

## Why neither MCP can do it

### `github` (upstream, hosted — not devloop's code)

`issue_write` accepts a milestone, but typed as a plain number:

```json
"milestone": { "description": "Milestone number", "type": "number" }
```

A JSON-schema `type: "number"` rejects `null`, and **omitting** the field on an update leaves the existing milestone untouched. There is no way to express "set this to none." This server is `https://api.githubcopilot.com/mcp/` (see `.mcp.json`) — devloop cannot patch it.

### `github-extras` (devloop's own — `bin/github-extras.js`)

This is the server that exists precisely to fill the upstream server's gaps (`close_milestone`, `create_milestone`, `create_label`, …). It has `assign_issues_to_milestone` — and **its handler already makes exactly the right API call**:

```js
// bin/github-extras.js:117-121
await githubRequest(
  'PATCH',
  `${owner}/${repo}/issues/${issue_number}`,
  { milestone: milestone_number }      // ← passing null here CLEARS the milestone
);
```

`PATCH /repos/{owner}/{repo}/issues/{n}` with `{"milestone": null}` is the documented GitHub REST way to remove an issue from a milestone. The handler would do it today, unchanged.

**The only thing blocking it is the input schema** (`bin/github-extras.js:232`):

```js
milestone_number: { type: 'number',  description: 'Milestone number to assign issues to' },
```

`null` is rejected at validation, before the handler is ever reached. The capability is present in the implementation and forbidden by its own declaration.

---

## The workaround, and why it isn't acceptable

Today the only path is the CLI:

```bash
gh issue edit 22 --repo stemolly/project --add-label "type:backlog" --remove-milestone
```

This works, and it is what I used. Three problems with leaving it as the answer:

1. **Undeclared dependency.** devloop's GitHub access is otherwise entirely MCP + `GITHUB_TOKEN`. Nothing in the README or the skills says "you also need `gh` installed and authenticated" — so a user who has a valid token but no `gh` login hits a hard failure in the middle of a sprint close, at the least recoverable moment.
2. **Nothing tells the model to do this.** The skills say "via GitHub MCP." A model following them faithfully will search for an MCP tool, not find one, and then either improvise `gh` (as I did), fabricate a tool call, or stall. Improvisation is the *good* outcome here, and it is still a silent deviation from the written procedure.
3. **Sandboxing.** Bash may be restricted or `gh` may prompt interactively; the MCP path has neither failure mode.

---

## Proposed fix

**Allow `milestone_number: null` on `assign_issues_to_milestone`.** Two lines, no handler change.

`bin/github-extras.js:232` —

```diff
-        milestone_number: { type: 'number',  description: 'Milestone number to assign issues to' },
+        milestone_number: {
+          type: ['number', 'null'],
+          description: 'Milestone number to assign issues to. Pass null to REMOVE the issues from their milestone (how an issue is carried over, sent to backlog, or dropped from a sprint).',
+        },
```

and widen the tool description (`:226`) —

```diff
-    description: 'Assign one or more issues to a GitHub milestone. Returns which assignments succeeded and which failed.',
+    description: 'Assign one or more issues to a GitHub milestone, or remove them from their milestone by passing milestone_number: null. Returns which assignments succeeded and which failed.',
```

`milestone_number` stays **required** — `null` must be explicit, so no accidental omission ever clears a milestone.

### Alternative, if an explicit verb reads better

Add a separate `remove_issues_from_milestone({ owner, repo, issue_numbers })` tool that calls the same helper with `null`. Costs a few more lines and one more entry in `TOOLS`, but the intent is unmistakable at the call site and it can't be reached by accident. Either is fine; the null-widening is the smaller diff and keeps one tool for one API endpoint.

### Then update the two skills

Once the tool exists, replace every *"clear the milestone via GitHub MCP"* with a concrete instruction naming the operation and its argument, so the model doesn't have to infer the mechanism:

- `skills/review/SKILL.md` — Step 2, the **carry over** and **backlog** apply bullets.
- `skills/replan/SKILL.md` — Operation: drop, the **to pool** and **to backlog** bullets.

Suggested wording: *"clear the issue's milestone via github-extras' `assign_issues_to_milestone` with `milestone_number: null`."*

---

## Note for whoever picks this up

Worth grepping the skills for other phrases of the form *"via GitHub MCP"* that name an outcome rather than a tool. This one was only caught because the operation was actually exercised — a sprint drop is rare, and reconcile's carry-over path is rarer still. The same latent gap could exist wherever a skill describes a GitHub mutation in prose and assumes a tool will be found for it.

`review`'s own instructions are explicit that this class of failure must not be papered over: *"Never fabricate a GitHub call result — if a tool can't be found or a call fails, stop and report."* Right now, following the skill to the letter leads to a tool that can't be found — so the skill is asking the model to stop and report on a gap in devloop itself. This is that report.

---

## Provenance

- `.mcp.json` — the two servers: `github` (hosted, upstream) and `github-extras` (`bin/github-extras.js`, local)
- `bin/github-extras.js:107-129` — `assignIssuesToMilestone`, whose PATCH body already supports clearing
- `bin/github-extras.js:225-241` — the input schema that forbids `null`
- `skills/review/SKILL.md` — Step 2, Reconcile issues → Apply
- `skills/replan/SKILL.md` — Operation: drop
- Triggering event: dropping `stemolly/project#22` from Sprint 1 to the backlog, 2026-07-13
