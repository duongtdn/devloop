---
description: Prepare a sprint iteration. Establishes the sprint goal through conversation, triages backlog issues, selects sprint-ready issues, creates a GitHub milestone, determines execution order, and writes the sprint file. Conversational — pauses at every step for user confirmation.
---

You are running **devloop:plan**. This skill is fully conversational — pause at every human gate and wait for explicit confirmation before moving to the next step. Never batch steps together.

User may have passed arguments via `$ARGUMENTS` (text typed after `/devloop:plan`). If present, treat it as an initial sprint goal hint — carry it forward to Step 2.

---

## Step 0 — Detect repo

If the GitHub repo (`owner/repo`) is not known from context, ask:

> Which GitHub repo should I use? (format: `owner/repo`):

**Validate** any entered value: must contain exactly one `/`, both parts non-empty, must not start with `http`/`git@` or contain `.git`. If invalid, ask again.

**Reachability check.** Verify the repo exists via GitHub MCP. If it fails:

> Could not reach `owner/repo` — [error]. Check the repo name and your GitHub token, then try again:

Repeat until confirmed reachable. Use the confirmed value as `$REPO` for all GitHub API calls in this session.

---

## Step 1 — Orient

### Master plan format

`context/sprints/master-plan.md` is owned and formatted by `/devloop:roadmap` — see that skill for the full spec. What matters here:

Each sprint entry in the Sprint Map looks like:

```markdown
### Sprint N — [Theme]
- **Goal:** [one sentence]
- **Status:** planned | active | completed
- **Sprint file:** `context/sprints/sprint-N.md`  ← written by this skill
```

This skill writes `Status: active` and the `Sprint file:` line. It may also update `Goal:` if the confirmed sprint goal differs from the draft in the master plan. It never changes `Status: completed` entries or removes sprint entries.

### If master-plan.md does not exist

The master plan must exist before planning a sprint — it defines the project vision and sprint themes that drive goal confirmation and issue triage.

> `context/sprints/master-plan.md` not found.
>
> Run `/devloop:roadmap` first to establish the project vision and sprint sequence. Once the master plan is written, come back to `/devloop:plan` to start the sprint.

Stop.

### If master-plan.md exists

Read `context/sprints/master-plan.md`.

**Check for an active sprint.** Scan the Sprint Map for any entry with `Status: active`.

If one is found:

> Sprint [N] is currently marked active in the master plan. Running `/devloop:review` closes a sprint before starting the next one.
>
> How do you want to proceed?
> - **continue** — ignore the active status and plan the next sprint anyway (e.g. you know the previous sprint is done)
> - **stop** — exit now so you can run `/devloop:review` first

Wait for response. On **stop**, exit. On **continue**, proceed.

**Determine the next sprint number** using two independent methods:

- **Method A (master plan):** find the highest sprint number in the Sprint Map whose `Status` is `completed` or `active`. Next = that number + 1. If no entries have either status, next = 1.
- **Method B (sprint files):** scan `context/sprints/` for files matching `sprint-N.md`. Next = highest N found + 1. If none exist, next = 1.

If both methods agree, use that number.

If they disagree:

> The master plan suggests Sprint [A] is next, but sprint files on disk go up to Sprint [B-1] — these don't match.
>
> Which sprint number should we use? (enter a number, or explain what happened):

Wait for the user to confirm or enter the correct sprint number. Use the confirmed value as `$SPRINT_N`. Then continue to the **Orient gate** section below.

---

### Orient gate (shared — runs for both new and existing master plan)

Derive scope context for Sprint `$SPRINT_N`:
- If the Sprint Map has an entry for Sprint `$SPRINT_N`, draw scope bullets from its `Goal:` and theme.
- If the Sprint Map has no entry for Sprint `$SPRINT_N` but has other entries, draw bullets from the overall vision and the trajectory of prior sprints.
- If the Sprint Map has no entries at all (file exists but only has a Vision section), draw bullets from the Vision section alone.

**Human gate — confirm sprint number and scope before proceeding:**

> **Sprint [N] — Orient**
>
> [2–4 bullet points describing what this sprint is expected to cover]
>
> Sprint number correct? Confirm or enter a different number:

Accept a plain "yes" / "y" to proceed with Sprint [N], or a number to override. Update `$SPRINT_N` if overridden.

`$SPRINT_N` is the sprint number for this session. All occurrences of `[N]` throughout the rest of this skill refer to `$SPRINT_N`.

---

## Step 2 — Sprint goal

The sprint goal is the anchor for all decisions in this session — triage outcomes, issue selection, and milestone description all flow from it. Establish it now, before touching any issues.

**Gather context using this priority order** — higher sources override lower ones:

1. **`$ARGUMENTS`** (highest) — if non-empty, treat as the strongest signal of intent. The user typed it explicitly as part of the command.
2. **Prior conversation** — if the conversation before this skill was invoked contains discussion of sprint direction, summarise that intent. Overrides the master plan.
3. **Master plan `Goal:`** (lowest) — if the Sprint [N] entry has a non-placeholder goal line, surface it as a starting point. A placeholder looks like `[brief scope]`, `TBD`, or similar — do not treat these as real goals.

If multiple sources are present, use the highest-priority one as the basis and note where it came from.

**Human gate — propose or ask, then confirm:**

If you have a proposed goal from any source above, present it and invite refinement:

> **Sprint [N] goal**
>
> Based on [your argument / our earlier conversation / the master plan], it sounds like the goal is:
>
> _"[proposed goal sentence]"_
>
> Does this capture what you want to deliver? Refine it or confirm as-is:

If you have no signal at all:

> **Sprint [N] goal** — describe what a user could demo at the end of this sprint:

**Goal quality check.** Before confirming, assess the response:
- A good goal is a single sentence a non-technical stakeholder could understand, describes a user-visible outcome, and is achievable within one sprint.
- If the input is vague (e.g. "do auth", "make progress", "finish features"), do not accept it as-is. Propose a sharpened version:

> That's a good direction. How about: _"[sharpened goal sentence]"_ — does that capture it?

Wait for the user to confirm or adjust. Once confirmed:

> Goal confirmed: _"[goal]"_

Store this as `$SPRINT_GOAL`. It will become the GitHub milestone description and is printed at the top of the sprint file.

**Update master plan.** In `context/sprints/master-plan.md`, find the `### Sprint [N]` section and set its `Goal:` line to `$SPRINT_GOAL`. If the section does not exist, append it to the Sprint Map. Do this whether the line was missing, a placeholder, or an older draft — the confirmed goal always wins.

Report:

> Master plan updated with sprint goal.

---

## Step 3 — Triage backlog

Delegate classification to a sub-agent to keep this context clean. Invoke the `backlog-triage` agent, passing `$REPO` and `$SPRINT_GOAL`. The agent fetches all `type:backlog` issues, classifies each against the sprint goal, and returns a structured result. Do not process backlog items yourself.

If the agent returns a response starting with `ERROR:`:

> Backlog triage failed: [error message]
>
> Skip triage and continue to Step 4? (y/n) — or fix the issue (check your GitHub token) and retry.

Wait for response. On yes, proceed to Step 4. On no, ask the user to resolve the issue and retry the agent.

If the agent reports zero backlog items (`TOTAL: 0`):

> No backlog items found — skipping triage.

Proceed to Step 4.

If the agent reports items but `ATTENTION: none` (all were auto-deferred):

> All [N] backlog items are clearly out of scope for this sprint and have been auto-deferred — skipping triage.

Proceed to Step 4.

Otherwise the agent returns:
- A count of auto-deferred items (out-of-scope, no user action needed)
- A table of items needing user attention, with bucket and rationale per row

**Human gate — present the agent's result:**

> **Backlog triage** — sprint goal: _"[SPRINT_GOAL]"_
>
> [N] items auto-deferred (clearly out of scope for this sprint). ← omit this line if AUTO_DEFERRED is 0
>
> [M] items need your attention:
>
> | # | Title | Bucket | Rationale |
> |---|-------|--------|-----------|
> | #12 | Add JWT middleware | relevant | Core piece of the auth flow |
> | #34 | Refactor DB pool | uncertain | May unblock auth but not strictly required |
> | #56 | Update onboarding copy | uncertain | Could relate to post-login UX |
>
> Decide for each: **resolve** / **defer** / **close**
> You can reply with bulk decisions (e.g. "defer all uncertain, resolve #12") or item-by-item.

Wait for the user's response. Accept bulk decisions and individual decisions in any combination.

**Processing decisions:**

Handle defer and close decisions immediately in batch:
- **defer** — leave open. No GitHub call needed.
- **close** — close via GitHub MCP with comment: `Closing as out of scope — can be reopened if priorities change.` If a close call fails, report it:

  > Failed to close #[N]: [error]. Retry? (y/n) — if no, it will be left open and noted in the triage summary.

  Wait for response. On yes, retry once. On no, leave open and count it as deferred in the summary.

For **resolve** items, work through them strictly one at a time. Do not move to the next until the current one is approved and created.

For each resolve item:

**Fetch.** Call the GitHub MCP to retrieve the full body of the backlog issue. Do not rely on the triage agent's summary — the full body is needed to reason about scope.

**Reason.** Read the full body and assess scope:
- If the item is small and well-defined, keep it as a single sprint-ready issue.
- If it is large or covers multiple distinct concerns, break it into smaller issues that are each independently executable within a sprint.

Suggest labels for each proposed issue:
- `type:` — one of `type:feature`, `type:bug`, `type:chore`, `type:question`, `type:decision`
- `epic:` — if the item belongs to a recognisable theme
- `area:` — if the item has a clear technical layer (`area:infra`, `area:api`, `area:web`, etc.)

**Human gate — present reasoning and proposal, wait for approval:**

> **Resolve #[N] ([X of Y]): [title]**
>
> [2–4 sentences explaining what this backlog item is about and the reasoning behind the proposed breakdown — or why it stays as one issue.]
>
> Proposed sprint-ready issue(s):
>
> | # | Title | type | epic | area |
> |---|-------|------|------|------|
> | 1 | Add login page | feature | auth | web |
> | 2 | Add JWT middleware | feature | auth | api |
>
> Approve to create, or tell me what to change:

Wait for the user's response:
- **Approved** — proceed to create.
- **Adjustments** — apply the changes (titles, labels, split differently, merge into one, add/remove items), show the updated proposal again, wait for re-approval.

**Create and close.** On approval, before creating issues, check whether each `epic:` label in the proposal already exists in `$REPO` via GitHub MCP. For any that are missing, create them now — no separate approval needed since the user already confirmed the label in the proposal table. Announce each new label created:

> Creating new label `epic:auth` in `$REPO`.

Then create each issue via GitHub MCP with the confirmed title, labels, and a body that includes `Derived from #[backlog-N]`. Then close the backlog item with a comment: `Resolved into: #[child1], #[child2], ...`

If this is not the last resolve item, announce and continue:

> #[N] resolved → created #[child1], #[child2]. Moving to next item.

If this is the last resolve item, announce completion:

> #[N] resolved → created #[child1], #[child2]. All resolve items done.

After all decisions are applied, report a one-line summary: `Backlog triage: [N auto-deferred] [N resolved] [N deferred] [N closed]`

---

## Step 4 — Select issues

Delegate to the `issue-selector` agent, passing `$REPO` and `$SPRINT_GOAL`. The agent fetches all open issues with no milestone and no `type:backlog` label (including any created during Step 3), classifies each against the sprint goal, and returns a structured result. Do not fetch or classify issues yourself.

If the agent returns a response starting with `ERROR:`:

> Issue selection failed: [error message]
>
> Check your GitHub token and repo access, then retry — or enter issue numbers manually to continue (format: `42 43 44`):

Wait for response. If the user provides issue numbers, use those as the selection and skip the suggestion table. Otherwise retry the agent.

If the agent reports zero issues:

> No sprint-ready issues found. Create issues with a type label (type:feature, type:bug, type:chore, type:question, type:decision) and no milestone, then re-run plan.

Stop.

**Human gate — present the agent's result and wait for selection:**

> **Sprint [N] goal:** _"[SPRINT_GOAL]"_
>
> | # | Title | Type | Epic | Area | Suggestion | Rationale |
> |---|-------|------|------|------|------------|-----------|
> | #43 | Add JWT middleware | feature | auth | api | include | Core requirement for the auth flow |
> | #42 | Add login page | feature | auth | web | include | Primary deliverable this sprint |
> | #38 | Fix CORS on preflight | bug | — | api | consider | Needed for web↔API calls but may be pre-existing |
> | #51 | Update readme | chore | — | — | skip | Documentation, unrelated to auth goal |
>
> Suggested selection: #42, #43 (and #38 if the CORS issue is actively blocking).
>
> Confirm, or adjust — add/remove issue numbers, or tell me what to change:

Wait for response. Accept issue numbers, ranges, or natural language ("add #38", "drop #51", "include all auth ones"). Require at least one issue.

If the user changes the selection, show the updated list before proceeding:

> Updated selection: #42, #43, #38 — proceed? (y/n)

---

## Step 5 — Create milestone

First, check whether a milestone named `Sprint [N]` already exists in `$REPO` using the **devloop milestones MCP**.

If it exists:

> Milestone "Sprint [N]" already exists (#[existing_number]). Reusing it — no new milestone will be created.

Set `$MILESTONE_NUMBER` to the existing milestone number and proceed.

If it does not exist, create it:
- Title: `Sprint [N]`
- Description: `$SPRINT_GOAL`

Report:

> Creating milestone "Sprint [N]" on GitHub...

Capture the returned milestone number as `$MILESTONE_NUMBER`.

If creation fails, report the error and stop — do not proceed without a milestone.

---

## Step 6 — Execution order

**Fetch issue details.** For each selected issue, call the GitHub MCP to retrieve its full body. This is needed to reason about dependencies between issues (e.g. "depends on #N" mentions, shared data models, sequencing cues in the description).

Collect all distinct `area:*` labels from the selected issues (strip the `area:` prefix to get the area name).

**Propose an execution order.** Reason about a sensible sequence:
- Apply the canonical dependency pattern where applicable: `infra` work typically must precede `api`, which typically must precede `web` or `mobile`. Use this as the default unless issue content suggests otherwise.
- Within each area, order by explicit dependencies found in issue bodies first, then by issue number ascending.
- Issues with no `area:` label go last, ordered by dependency then issue number.
- If no `area:*` labels exist at all, order by dependency reasoning then issue number.

**Human gate — propose the full ordered list with rationale and wait for confirmation:**

> **Execution order for Sprint [N]**
>
> [1–2 sentences explaining the proposed ordering logic — e.g. "infra first to set up the database layer, then api to implement the endpoints, then web to wire up the UI."]
>
> | Order | # | Title | Area |
> |-------|---|-------|------|
> | 1 | #44 | Add session persistence | infra |
> | 2 | #43 | Add JWT middleware | api |
> | 3 | #42 | Add login page | web |
> | 4 | #45 | Password reset flow | web |
>
> Confirm, or adjust — reorder by listing issue numbers (e.g. `44 43 45 42`), or describe what to change:

Wait for confirmation or adjustment. Apply any reordering the user provides. If adjusted, show the updated table once more before proceeding.

---

## Step 7 — Assign issues and write sprint file

**Assign issues to milestone:** For each selected issue, call the **devloop milestones MCP** to assign it to `$MILESTONE_NUMBER` in `$REPO`.

If any assignments fail:

> Failed to assign: #[N], #[N]
>
> Retry? (y/n) — if no, these issues will be left unassigned and noted in the sprint file.

Wait for response. On yes, retry the failed assignments. On no, continue and mark them as unassigned in the sprint file with a `⚠ unassigned` note.

**Write sprint file:** Create `context/sprints/` if it does not exist. Write `context/sprints/sprint-[N].md`:

```
# Sprint [N]

**Goal:** [sprint goal]
**Milestone:** #[milestone_number]
**Repo:** [owner/repo]
**Created:** [ISO8601 date, date only]
**Areas:** [area1 → area2 → area3]  ← omit this line if no area labels were found

## Issues

- [ ] #[N] — [title] ([labels: area:x, epic:y — omit if none])
[one line per issue, in execution order]
```

Example:

```markdown
# Sprint 3

**Goal:** Ship the authentication flow end to end
**Milestone:** #5
**Repo:** acme/backend
**Created:** 2026-06-26
**Areas:** infra → api → web

## Issues

- [ ] #44 — Add session persistence (area:infra)
- [ ] #43 — Add JWT middleware (area:api, epic:auth)
- [ ] #42 — Add login page (area:web, epic:auth)
- [ ] #45 — Password reset flow (area:web, epic:auth)
```

**Update master plan:** In `context/sprints/master-plan.md`, find the `### Sprint [N]` section and ensure it has:
- `Status: active`
- `Sprint file: context/sprints/sprint-[N].md`

If the section does not exist (e.g. roadmap was run but did not include this sprint number), append it as a minimal entry with no theme name: `### Sprint [N]`. This is a fallback — the expected path is for roadmap to have written this entry first.

---

## Completion report

When done, report:

> **Sprint [N] ready**
>
> Goal: _"[SPRINT_GOAL]"_
> Milestone: Sprint [N] (#[milestone_number]) · Sprint file: `context/sprints/sprint-[N].md`
>
> **Backlog** _(omit this section entirely if Step 3 was skipped)_
> [N] resolved · [N] deferred · [N] closed · [N] auto-deferred _(omit any counts that are zero)_
>
> **Execution order**
>
> | Order | # | Title | Area |
> |-------|---|-------|------|
> | 1 | #44 | Add session persistence | infra |
> | 2 | #43 | Add JWT middleware | api |
> | 3 | #42 | Add login page | web |
> | 4 | #45 | Password reset flow | web |
>
> Run `/devloop:run` to start executing.
