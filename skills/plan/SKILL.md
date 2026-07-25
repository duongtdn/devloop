---
description: Prepare a sprint iteration. Establishes the sprint goal and end-of-sprint demo through conversation, triages backlog issues into sprint tasks (many-to-many, with per-item disposition), selects sprint-ready issues, assesses whether the selection covers the goal and authors net-new tasks (under an inline architect conversation) to fill any gap, ensures every issue has acceptance criteria and a Definition of Done, creates a GitHub milestone, determines execution order, and writes the sprint file. Conversational — pauses at every step for user confirmation.
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

`.context/sprints/master-plan.md` is owned and formatted by `/devloop:roadmap` — see that skill for the full spec. What matters here:

Each sprint entry in the Sprint Map looks like:

```markdown
### Sprint N — [Theme]
- **Goal:** [one sentence]
- **Demo:** [the watchable product increment at sprint end — the observable proof of the Goal; may be dev/CI-facing for early sprints]
- **Status:** planned | active | completed
- **Sprint file:** `.context/sprints/sprint-N.md`  ← written by this skill
```

This skill writes `Status: active` and the `Sprint file:` line. It may also update `Goal:` if the confirmed sprint goal differs from the draft, and `Demo:` if the confirmed sprint demo differs from the draft. It never changes `Status: completed` entries or removes sprint entries.

### If master-plan.md does not exist

The master plan must exist before planning a sprint — it defines the project vision and sprint themes that drive goal confirmation and issue triage.

> `.context/sprints/master-plan.md` not found.
>
> Run `/devloop:roadmap` first to establish the project vision and sprint sequence. Once the master plan is written, come back to `/devloop:plan` to start the sprint.

Stop.

### If master-plan.md exists

Read `.context/sprints/master-plan.md`.

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
- **Method B (sprint files):** scan `.context/sprints/` for files matching `sprint-N.md`. Next = highest N found + 1. If none exist, next = 1.

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

### Read project profile

Read `.context/devloop-profile.md` — devloop's operational manifest (build/test commands and test layout). For this skill, the only thing that matters is **whether the project has tests**, because that shapes the acceptance criteria and Definition of Done written into issues.

This file is the single source for project commands. Do not read commands from anywhere else or guess them. Stack, architecture, and conventions come from the auto-loaded project instructions (CLAUDE.md) already in context — this skill does not duplicate them.

**If the profile exists**, extract:
- `$HAS_UNIT_TESTS` — true if a `unit-test:` command is present
- `$HAS_E2E` — true if an `e2e-test:` command is present

**If it does not exist**, warn:

> `.context/devloop-profile.md` not found — it's normally created by `/devloop:roadmap`. Without it, the acceptance criteria and Definition of Done written into issues will be generic (no project-specific test steps).
>
> Continue without it? (y/n) — or run `/devloop:roadmap` first to set up the profile.

On **y**, set both `$HAS_UNIT_TESTS` and `$HAS_E2E` to `unknown` and proceed; the Definition of Done will omit test-specific lines. On **n**, exit so the user can run roadmap.

---

## Step 2 — Sprint goal and demo

The sprint goal is the anchor for all decisions in this session — triage outcomes, issue selection, and milestone description all flow from it. Establish it now, before touching any issues. Alongside the goal, confirm the **sprint demo** — the concrete, watchable product increment at the end of this sprint (the observable proof of the goal, not a restatement of it; it may be developer/CI-facing for an early sprint).

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

**Confirm the sprint demo.** With the goal settled, refine the demo the same way. Source a draft, highest priority first:

1. **Prior conversation** — if the discussion described what would be demoed, reviewed, or tested at this sprint's end, use that.
2. **Master plan `Demo:`** — if the Sprint [N] entry has a non-placeholder demo line, surface it.
3. **Draft from the goal** — otherwise, draft a plausible demo: the observable increment that would prove `$SPRINT_GOAL` is met. If the goal is early-stage with no user-facing surface yet, make it developer/CI-facing and say so.

Present it and invite refinement:

> **Sprint [N] demo** — what you'll be able to watch at sprint end:
>
> _"[proposed demo — the concrete increment; note "(dev/CI-facing)" if there's no UI yet]"_
>
> This is the observable proof of the goal, not a restatement of it. Refine it or confirm as-is:

**Demo quality check.** Reject a demo that merely echoes the goal or names no watchable artifact. If it does, propose a sharper version tied to a concrete thing a person could see or run. Once confirmed:

> Demo confirmed: _"[demo]"_

Store this as `$SPRINT_DEMO`.

**Update master plan.** In `.context/sprints/master-plan.md`, find the `### Sprint [N]` section and set its `Goal:` line to `$SPRINT_GOAL` and its `Demo:` line to `$SPRINT_DEMO` (immediately under `Goal:`). If the section does not exist, append it to the Sprint Map; if the `Demo:` line is missing, add it. Do this whether a line was missing, a placeholder, or an older draft — the confirmed values always win.

Report:

> Master plan updated with sprint goal and demo.

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

| # | Title | Bucket | Rationale |
|---|-------|--------|-----------|
| #12 | Add JWT middleware | relevant | Core piece of the auth flow |
| #34 | Refactor DB pool | uncertain | May unblock auth but not strictly required |
| #56 | Update onboarding copy | uncertain | Could relate to post-login UX |

> Decide for each: **resolve** / **defer** / **close**
> You can reply with bulk decisions (e.g. "defer all uncertain, resolve #12") or item-by-item.

Wait for the user's response. Accept bulk decisions and individual decisions in any combination.

**Processing decisions:**

Handle defer and close decisions immediately in batch:
- **defer** — leave open. No GitHub call needed.
- **close** — close via GitHub MCP with comment: `Closing as out of scope — can be reopened if priorities change.` If a close call fails, report it:

  > Failed to close #[N]: [error]. Retry? (y/n) — if no, it will be left open and noted in the triage summary.

  Wait for response. On yes, retry once. On no, leave open and count it as deferred in the summary.

For **resolve** items, reason across the whole set together — do **not** process them one at a time. The backlog-item→task relationship is many-to-many: a task may synthesize several backlog items, one backlog item may split across several tasks, and the coverage can overlap. Handling items in isolation cannot express that.

**Fetch all.** Call the GitHub MCP to retrieve the full body of every resolve item. Do not rely on the triage agent's summary — the full bodies are needed to reason about scope and overlap across items.

**Reason across the set.** Read the bodies together and propose a set of sprint-ready tasks that covers them:
- A small, self-contained item maps to a single task.
- A large item splits into several tasks, each independently executable within a sprint.
- A single task may draw from several items — record **all** of them as its provenance.

Suggest labels for each proposed task:
- `type:` — one of `type:feature`, `type:bug`, `type:chore`, `type:question`, `type:decision`
- `epic:` — if the task belongs to a recognisable theme
- `area:` — if the task has a clear technical layer (`area:infra`, `area:api`, `area:web`, etc.)

**Draft acceptance criteria** for each proposed task from the source backlog bodies, following the acceptance-criteria rules in the spec (below).

**Per-item disposition.** Once the task set is settled, each resolve item lands in exactly one state, by how much of it the tasks cover — decided *after* the tasks are approved, not per-iteration:
- **fully subsumed** — every concern it raised became a task → close it.
- **partially drawn from** — some concerns became tasks, the remainder is out of this sprint → leave it open.
- **not drawn from** — reasoning found nothing to pull in this sprint → leave it open (counts as deferred).

### Issue body template — read the shared spec

Every issue this skill creates follows **`plan-spec.md`** (in this skill's directory, alongside SKILL.md) — the shared spec for the issue body template, the acceptance-criteria rules, the **Definition-of-Done-by-type** rule (the issue's `type:` label × the profile test flags `$HAS_UNIT_TESTS`/`$HAS_E2E` from Step 1), and label conventions. Read it now if not already loaded; `/devloop:replan` reads the same file, which is what keeps sprint amendments format-identical to sprint creation. Tasks resolved from backlog item(s) carry the spec's `Derived from #A[, #B]` line, listing **every** source item.

**Human gate — present the collective proposal, wait for approval:**

> **Backlog resolution → Sprint [N] tasks**
>
> [2–4 sentences on how the resolve items map onto the proposed tasks — which items combined, which split, where coverage overlaps.]
>
> Proposed sprint-ready tasks:

| # | Title | type | epic | area | From backlog |
|---|-------|------|------|------|--------------|
| 1 | Add login page | feature | auth | web | #12 |
| 2 | Add JWT middleware | feature | auth | api | #12, #34 |

> Acceptance criteria:
>
> **1. Add login page**
> - [ ] User can enter email + password and submit
> - [ ] Invalid credentials show an inline error
> - [ ] Successful login redirects to the dashboard
>
> **2. Add JWT middleware**
> - [ ] Requests without a valid token receive 401
> - [ ] A valid token resolves the authenticated user
>
> Definition of Done: [per the DoD-by-type rule — list each task's DoD lines given its type and the profile; group if several share a type]
>
> Backlog disposition:

| Backlog | Disposition | Why |
|---------|-------------|-----|
| #12 | close — fully subsumed | Every concern became tasks 1 and 2 |
| #34 | stay open — partially drawn | JWT refresh became task 2; rotation deferred |

> Approve to create, or tell me what to change — titles, labels, criteria, the mapping, or a disposition:

Wait for the user's response:
- **Approved** — proceed to create and dispose.
- **Adjustments** — apply the changes (titles, labels, split/merge differently, re-map provenance, change a disposition, add/remove tasks), show the updated proposal again, wait for re-approval.

**Create and dispose.** On approval, before creating tasks, check whether each `epic:` label in the proposal already exists in `$REPO` via GitHub MCP. For any that are missing, create them now — no separate approval needed since the user already confirmed the label in the proposal table. Announce each new label created:

> Creating new label `epic:auth` in `$REPO`.

Then create each task via GitHub MCP with the confirmed title, labels, and a body following the **issue body template** above — the approved `## What`, `## Acceptance Criteria`, the profile-derived `## Definition of Done`, and a `Derived from` line listing **every** source backlog item for that task (e.g. `Derived from #12, #34`).

Then apply each backlog item's disposition:
- **fully subsumed** — close it with comment `Resolved into: #[child1], #[child2], …` (every task that drew from it).
- **partially drawn from** — leave it open, post comment `Partially addressed by #[childX][, #childY]; remainder out of scope for Sprint [N].`
- **not drawn from** — leave it open, no comment (counted as deferred in the summary).

If a close or comment call fails, report it and offer to retry once; on decline, leave the item as-is and note it in the summary.

Report a one-line summary: `Backlog triage: [N auto-deferred] [N resolved] [N partially resolved] [N deferred] [N closed]`

---

## Step 4 — Select issues

Delegate to the `issue-selector` agent, passing `$REPO` and `$SPRINT_GOAL`. The agent fetches all open issues with no milestone and no `type:backlog` label (including any created during Step 3), classifies each against the sprint goal, and returns a structured result. Do not fetch or classify issues yourself.

If the agent returns a response starting with `ERROR:`:

> Issue selection failed: [error message]
>
> Check your GitHub token and repo access, then retry — or enter issue numbers manually to continue (format: `42 43 44`):

Wait for response. If the user provides issue numbers, use those as the selection and skip the suggestion table. Otherwise retry the agent.

If the agent reports zero issues:

> No pre-existing sprint-ready issues found — we'll build Sprint [N] from the goal directly.

Set the confirmed selection to empty and skip the selection gate below — go straight to **Step 4.5**, which authors the sprint's tasks from the goal.

**Human gate — present the agent's result and wait for selection:**

> **Sprint [N] goal:** _"[SPRINT_GOAL]"_

| # | Title | Type | Epic | Area | Suggestion | Rationale |
|---|-------|------|------|------|------------|-----------|
| #43 | Add JWT middleware | feature | auth | api | include | Core requirement for the auth flow |
| #42 | Add login page | feature | auth | web | include | Primary deliverable this sprint |
| #38 | Fix CORS on preflight | bug | — | api | consider | Needed for web↔API calls but may be pre-existing |
| #51 | Update readme | chore | — | — | skip | Documentation, unrelated to auth goal |

> Suggested selection: #42, #43 (and #38 if the CORS issue is actively blocking).
>
> Confirm, or adjust — add/remove issue numbers, or tell me what to change:

Wait for response. Accept issue numbers, ranges, or natural language ("add #38", "drop #51", "include all auth ones"). Require at least one issue.

If the user changes the selection, show the updated list before proceeding:

> Updated selection: #42, #43, #38 — proceed? (y/n)

---

## Step 4.5 — Coverage & gap-fill

Every sprint, check whether the confirmed selection actually **covers** the sprint goal and demo. Step 4 can only pick from issues that already exist, so a goal can need work no issue yet captures. This step runs even when Step 4 found a full selection — it is the one place `plan` authors net-new work.

**Assess coverage** (inline). Reason over `$SPRINT_GOAL` and `$SPRINT_DEMO` against the selected issues — their titles, types, areas, and the selector's rationale; fetch a body only if a title is too thin to judge. Ask: if every selected issue shipped, would the demo be watchable and the goal met? Name any concern the goal/demo implies that no selected issue owns.

If the selection covers the goal, say so and continue:

> Selection covers the Sprint [N] goal and demo — no gap-fill needed.

Proceed to Step 5.

**On a gap — author under the architect's lens.** There is a gap (or Step 4 found zero issues). Net-new tasks must be shaped by design, not invented in a vacuum — so bring a senior architect's judgment into context before drafting: **invoke the `/devloop:architect` skill inline, once**, scoped to the gap (e.g. _"what work does '[goal]' need that the current selection #… doesn't cover?"_). This is a single load of architect's judgment lens to author the gap tasks under — **not** a separate architect Q&A run at the user (no "who edits this? how often?" intake); you apply its method to the authoring yourself. Its judgment structure (leanings → forces → tie-breakers → precedent) and character load into the context window and drive the authoring — and because that character already scales deliberation to reversibility, a trivial gap task gets a fast call under the same lens, not ceremony it doesn't need:

- It reads `.context/decisions/index.md` first, so authored tasks **conform to and cite** any governing ADR.
- Its concreteness leash keeps each task's scope landing on a real destination (file, boundary, signature) rather than a vague outcome.
- Where a task rests on a genuine unrecorded decision — a one-way door, a new boundary or contract others will import — architect's own **ADR gate** records it before the task is frozen; a mere preference stays in the chat and gets no ADR. This is architect's threshold; do not lower it to force an ADR per task, and do not raise one for a two-way door.

Architect supplies the judgment and any ADRs; per its own rule it does **not** create issues — `plan` authors them.

**Draft the tasks.** From the architect-informed reasoning, draft each net-new sprint-ready task following the **issue body template** in `plan-spec.md` — `## What`, `## Acceptance Criteria`, and the profile-derived `## Definition of Done` per its `type:`. These tasks carry **no** `Derived from` line (they came from the goal, not a backlog item). Suggest `type:`/`epic:`/`area:` labels as in Step 3.

**Human gate — present the authored tasks, wait for approval:**

> **Sprint [N] gap-fill** — the goal needs work the selection doesn't cover:
>
> [1–2 sentences naming the gap and the design reasoning behind the proposed tasks; cite any ADR recorded or followed.]
>
> Proposed sprint-ready tasks:

| # | Title | type | epic | area |
|---|-------|------|------|------|
| 1 | Add token refresh endpoint | feature | auth | api |

> Acceptance criteria:
>
> **1. Add token refresh endpoint**
> - [ ] An expired access token can be exchanged via a valid refresh token
> - [ ] A revoked refresh token receives 401
>
> Definition of Done: [per the DoD-by-type rule — group if several share a type]
>
> Approve to create, or tell me what to change — titles, labels, criteria, or scope:

Wait for the response. On adjustments, revise and re-present. On approval:
- create any missing `epic:`/`area:` labels via GitHub MCP (announce each), as in Step 3.
- create each task via GitHub MCP with the confirmed title, labels, and template body (**no** `Derived from` line).
- **add the created issue numbers to the confirmed selection** so Steps 5–8 assign, order, validate, and write them like any other selected issue.

Report:

> Gap-fill: created #[…]. Selection now: #[…].

---

## Step 5 — Create milestone

First, check whether a milestone named `Sprint [N]` already exists in `$REPO` using the **`github-extras` MCP**.

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

| Order | # | Title | Area |
|-------|---|-------|------|
| 1 | #44 | Add session persistence | infra |
| 2 | #43 | Add JWT middleware | api |
| 3 | #42 | Add login page | web |
| 4 | #45 | Password reset flow | web |

> Confirm, or adjust — reorder by listing issue numbers (e.g. `44 43 45 42`), or describe what to change:

Wait for confirmation or adjustment. Apply any reordering the user provides. If adjusted, show the updated table once more before proceeding.

---

## Step 7 — Validate acceptance criteria

Every selected issue must carry acceptance criteria before `run` executes it — they are the contract `run` reads to plan and validate the work. Issues created during Step 3 already have them. Pre-existing sprint-ready issues selected in Step 4 may not.

You already fetched the full body of each selected issue in Step 6. For each, check whether the body contains an `## Acceptance Criteria` section with at least one checklist item.

If every selected issue has acceptance criteria, report and continue:

> All selected issues have acceptance criteria.

Otherwise, list the gaps:

> These issues have no acceptance criteria:
>
> - #42 — Add login page
> - #45 — Password reset flow
>
> `run` needs these to plan and validate the work. Draft them now? (y/n — or `skip #N` to leave specific ones)

On **n** or `skip`, leave the issue untouched and note it; `run` will prompt for criteria when it reaches the issue.

For each issue to draft, work one at a time: read its current body, then propose the missing sections following the issue body template in **`plan-spec.md`** — the Definition of Done per its DoD-by-type rule (the issue's `type:` label plus `$HAS_UNIT_TESTS` / `$HAS_E2E`).

> **#42 — Add login page**
>
> [draft ## What + ## Acceptance Criteria + ## Definition of Done]
>
> Approve to update the issue, or adjust:

On approval, update the GitHub issue body via GitHub MCP — preserve any existing content and append the missing sections. Do not overwrite a body that already has a `## What` or description.

---

## Step 8 — Assign issues and write sprint file

**Assign issues to milestone:** For each selected issue, call the **`github-extras` MCP** to assign it to `$MILESTONE_NUMBER` in `$REPO`.

If any assignments fail:

> Failed to assign: #[N], #[N]
>
> Retry? (y/n) — if no, these issues will be left unassigned and noted in the sprint file.

Wait for response. On yes, retry the failed assignments. On no, continue and mark them as unassigned in the sprint file with a `⚠ unassigned` note.

**Write sprint file:** Create `.context/sprints/` if it does not exist. Write `.context/sprints/sprint-[N].md` following the **sprint file format in `plan-spec.md` §3** (header lines + one issue line per selected issue, in the confirmed execution order; annotate `⚠ unassigned` per the spec where milestone assignment failed).

Example:

```markdown
# Sprint 3

**Goal:** Ship the authentication flow end to end
**Demo:** Log in through the browser with email + password and land on the dashboard; a bad password shows an inline error
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

**Update master plan:** In `.context/sprints/master-plan.md`, find the `### Sprint [N]` section and ensure it has:
- `Status: active`
- `Sprint file: .context/sprints/sprint-[N].md`

If the section does not exist (e.g. roadmap was run but did not include this sprint number), append it as a minimal entry with no theme name: `### Sprint [N]`. This is a fallback — the expected path is for roadmap to have written this entry first.

---

## Completion report

When done, report:

> **Sprint [N] ready**
>
> Goal: _"[SPRINT_GOAL]"_
> Demo: _"[SPRINT_DEMO]"_
> Milestone: Sprint [N] (#[milestone_number]) · Sprint file: `.context/sprints/sprint-[N].md`
>
> **Backlog** _(omit this section entirely if Step 3 was skipped)_
> [N] resolved · [N] partially resolved · [N] deferred · [N] closed · [N] auto-deferred _(omit any counts that are zero)_
>
> **Gap-fill** _(omit this section entirely if Step 4.5 authored nothing)_
> [N] tasks authored from the goal (#…) · [N] ADR(s) recorded (ADR-… — [title]) _(omit the ADR clause if none)_
>
> **Execution order**

| Order | # | Title | Area |
|-------|---|-------|------|
| 1 | #44 | Add session persistence | infra |
| 2 | #43 | Add JWT middleware | api |
| 3 | #42 | Add login page | web |
| 4 | #45 | Password reset flow | web |

> Run `/devloop:run` to start executing.
