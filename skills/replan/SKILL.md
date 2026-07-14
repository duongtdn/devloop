---
description: Amend the active sprint — add an issue, drop one, reorder execution, re-scope or split an issue, or create a rework issue for shipped work that needs changes. The transactional sibling of /devloop:plan; both read the same plan-spec.md so amendments stay format-identical to sprint creation. Conversational — proposes each change and waits for confirmation before touching GitHub or the sprint file. Often invoked from /devloop:review to turn feedback into tracked work.
---

You are running **devloop:replan**. This skill applies **deltas to the active sprint**: it keeps the GitHub milestone, the issues, and the sprint file consistent while the sprint is in flight. It is the *only* sanctioned way to change a sprint's composition mid-sprint — other skills (notably `review`) route their plan changes through it rather than editing tracking files ad hoc.

`/devloop:plan` creates a sprint (the greenfield wizard); `replan` amends one. Both follow **`plan-spec.md`** in the `plan` skill's directory (`skills/plan/plan-spec.md` in this plugin) — the shared spec for the issue body template, DoD-by-type, labels, the sprint-file line grammar, and rework cross-links. **Read it before applying any operation.**

User may have passed arguments via `$ARGUMENTS` — treat them as the intent (e.g. `add #38`, `drop #51 to backlog`, `rework #44: toast doesn't show on slow networks`, `reorder 44 43 42`, `split #45`). If empty, ask what to change.

---

## Step 0 — Resolve sprint, repo, and guards

**Active sprint.** Read `.context/sprints/master-plan.md`; find the entry with `- **Status:** active` and use its sprint number and `Sprint file:`. If none is active, fall back to the highest `.context/sprints/sprint-N.md` on disk. If no sprint file can be found:

> No active sprint found — run `/devloop:plan` first. `replan` amends an existing sprint; it doesn't create one.

Stop. Otherwise read the sprint file; extract `$SPRINT_N`, `$SPRINT_GOAL`, `$MILESTONE_NUMBER`, `$REPO`, and the issue lines (per the spec's line grammar — preserve each line's checkbox state, labels, and any `⚠ unassigned` / `✓accepted` annotations exactly).

**Profile flags.** Read `.context/devloop-profile.md` if present: `$HAS_UNIT_TESTS`, `$HAS_E2E` (for DoD lines on any issue this skill creates). Absent → both `unknown`.

**Run-in-flight guard.** Read `.context/sprints/state/.lock` if it exists; check PID liveness (`kill -0 <pid> 2>/dev/null`). If a **live `run`** holds it, note the locked issue `#L`:
- Operations touching **other** issues are safe — proceed.
- An operation targeting `#L` itself (drop, re-scope, reorder past it):

> ⚙ run is actively executing #[L] right now. Changing it mid-run leads to divergence — finish or `/devloop:abort` that run first. I can queue every other change.

Never drop or re-scope the actively-running issue.

**Repo reachability.** Verify `$REPO` via GitHub MCP. If unreachable, report the error and stop — every operation here needs GitHub. (Never fabricate a call result; if a tool can't be found or a call fails, stop and report.)

---

## Step 1 — Understand the request

Map the user's intent to one or more operations below. If ambiguous, ask. Multiple operations in one invocation are fine — apply them **one at a time**, each with its own confirm → apply → report cycle, sprint file updated after each (idempotent: re-running a half-applied request skips what's already done).

| Operation | What it does |
|---|---|
| **add** | bring an issue into the sprint (existing open issue, or create a new one) |
| **rework** | create a new issue linked to a shipped one, from review feedback |
| **drop** | take an issue out of the sprint (to pool, to backlog, or closed) |
| **reorder** | change the execution order of not-yet-started issues |
| **re-scope** | edit an issue's acceptance criteria / split it into smaller issues |

---

## Operation: add

**Existing issue** (`add #N`): fetch it via GitHub MCP. It must be open and not `type:backlog` (a backlog item needs resolving first — offer to re-scope it into sprint-ready form here, following the spec's template, rather than bouncing the user to `plan`). Check it has an `## Acceptance Criteria` section; if not, draft one per the spec and confirm.

**New issue** (`add: <description>`): draft title, labels (`type:` required; `epic:`/`area:` as applicable), and a body per the spec's template — `## What`, `## Acceptance Criteria`, `## Definition of Done` by type × profile flags.

Propose placement in the execution order (the spec's ordering rules: `infra → api → web`, dependencies, then issue number) and present:

> **Add to Sprint [N]:** [#N — title | new issue "title"]
>
> [labels · 1-line rationale]
> [body preview, for a new issue]
> Position: [k] of [total] (after #X, before #Y) — [reason]
>
> Confirm to [create and] add? (y / adjust)

On confirmation: create the issue if new (creating any missing `epic:`/`area:` labels first, announced); assign it to milestone `$MILESTONE_NUMBER` via the milestone-assignment operation (bundled github-extras MCP); insert its line into the sprint file at the confirmed position (unchecked, per the spec grammar — annotate `⚠ unassigned` if assignment failed after one retry).

> ✔ #[N] added to Sprint [N] at position [k].

---

## Operation: rework

Input: the shipped source issue `#N` and the feedback (what's wrong / what must change). Usually invoked from `/devloop:review` with both supplied; if invoked directly, fetch `#N` and ask for the feedback if missing.

Rework = **a new issue in the sprint**; the original stays closed/merged — history is carried by cross-links, not by reopening (spec §4).

1. Draft the rework issue per the spec: title (imperative, from the feedback), labels (inherit `area:`/`epic:` from `#N`; `type:bug` for a behavioral defect, else the original's type), body with `## What` (the feedback in plain language, with 1 line of context from `#N`), `## Acceptance Criteria` (derived from the feedback — what "fixed" observably means), DoD by type, and the trailing **`Rework of #[N]`** line.
2. Present the draft + proposed execution-order position; confirm (y / adjust).
3. On confirmation: create the issue → **post the backlink comment on `#N`**: `Rework tracked in #[M]` → assign to the milestone → insert the sprint-file line.

> ✔ Rework of #[N] created as #[M], added to Sprint [N] at position [k]. (#[N] carries the backlink.)

---

## Operation: drop

Only an **unstarted** issue can be dropped cleanly (unchecked, no state file in `.context/sprints/state/`). For an issue with run state, point to `/devloop:abort` first. Dispositions (same vocabulary as `review`'s reconcile):

- **to pool** (default) — clear its milestone (see below); it returns to the sprint-ready pool for a later `plan`.
- **to backlog** — add `type:backlog`, then clear the milestone; `plan`'s triage will re-assess it.
- **close** — close via GitHub MCP with a comment: `Closed at Sprint [N] replan — [out of scope / superseded / reason].`

**Clearing a milestone** — use the **bundled github-extras MCP's milestone-assignment operation** with `milestone_number: null` (plus `owner`, `repo`, `issue_numbers`). Passing null is what removes the issues from their milestone; the **official** GitHub MCP cannot express it (its milestone field takes a number and rejects null, and omitting the field leaves the milestone untouched), so don't hunt for it there and don't shell out to `gh`. The clear is what makes the issue selectable again — `issue-selector` only sees issues with no milestone — so a drop whose clear failed is a drop that didn't happen: report the failure, and leave the sprint-file line in place.

Present the issue, the proposed disposition, and the consequence; confirm; apply; **remove its line** from the sprint file (never renumber or touch other lines).

> ✔ #[N] dropped from Sprint [N] → [pool | backlog | closed].

---

## Operation: reorder

Only **unstarted** issues may move (checked-off work is history; an in-flight issue's position is fixed by the guard above). Accept a full or partial order (`reorder 44 43 42`, "move #45 before #43"). Present the resulting table (old → new), confirm, rewrite the `## Issues` lines in the new order **preserving every line's content verbatim** (checkboxes, labels, annotations).

> ✔ Sprint [N] execution order updated.

---

## Operation: re-scope / split

**Re-scope** (`rescope #N: <what changed>`): fetch the issue, propose edited `## Acceptance Criteria` (and `## What` if the framing changed) per the spec's AC rules. Confirm, then update the issue body via GitHub MCP — preserve all other sections. If the issue is mid-flight or done, refuse (that's rework or abort territory).

**Split** (`split #N`): when an unstarted issue is too big, propose 2+ child issues per the spec's template (each independently executable), present the set, confirm. On approval: create the children, assign each to the milestone, close `#N` with the comment `Resolved into: #[c1], #[c2], ...`, replace `#N`'s sprint-file line with the children's lines at the same position (in dependency order).

> ✔ #[N] split into #[c1], #[c2] — sprint file and milestone updated.

---

## Completion report

After all requested operations, print a one-line-per-change summary and the current issue table:

> **Sprint [N] replanned** — [n] change(s): [add #43 · rework #44→#52 · drop #51 → backlog]
>
> | Order | # | Title | State |
> |---|---|---|---|
> | 1 | #44 | Add session persistence | done ✓accepted |
> | 2 | #52 | Fix toast on slow networks (rework of #44) | not started |
>
> [If a run/sprint is idle:] `/devloop:run` or `/devloop:sprint` picks up the new work in order.

---

## Exception handling

- **GitHub MCP failure** — report; retry once on the user's go-ahead. Milestone-assignment failure after retry → annotate the sprint-file line `⚠ unassigned` and continue. Issue-creation failure → stop that operation (nothing to track yet); the sprint file is only touched after the GitHub side succeeds.
- **No suitable tool / uncertain result** — never fabricate. Stop and return `ERROR: [reason]`.
- **Sprint file and GitHub disagree** (e.g. line exists but issue has no milestone) — surface the drift and propose the fix as an explicit operation; don't silently repair.
- **Concurrent run started mid-replan** — re-check the lock before each apply step; if a live run appears and holds the target issue, stop that operation per the Step 0 guard.
