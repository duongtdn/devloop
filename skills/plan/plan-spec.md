# plan-spec — shared sprint formats

The single source of truth for **what a sprint issue and a sprint file look like**. Read by
`/devloop:plan` (creating a sprint) and `/devloop:replan` (amending one) so the two can never drift.
Other skills (`run`, `review`, `status`) *read* artifacts in these formats but do not define them.

---

## 1. Issue body template

Every sprint-ready issue created by a devloop skill uses this body:

```markdown
## What
[2–3 sentences: what this issue delivers, in plain language]

## Acceptance Criteria
- [ ] [concrete, verifiable outcome]
- [ ] [concrete, verifiable outcome]

## Definition of Done
[the lines from the DoD-by-type rule below]

Derived from #[backlog-N]     ← only when resolved from a backlog item
Rework of #[N]                ← only for a rework issue (see §4)
```

**Acceptance criteria rules.** They are the contract `run` reads to plan and validate the work, so:
- Each criterion is a single user-visible or testable outcome, phrased as a checklist item.
- Aim for 2–5 per issue. Cover the happy path and the obvious failure/edge cases the item implies.
- Do not invent scope the source item does not imply. If it is too vague to derive criteria, ask the
  user rather than padding.

## 2. Definition of Done by type

The DoD is chosen by the issue's `type:` label **and** the project-profile test flags
(`$HAS_UNIT_TESTS` / `$HAS_E2E` from `.context/devloop-profile.md`) — include only the lines that
apply. `run` reads the DoD: it activates a review phase when `Code reviewed` is present and checks
DoD items at validation, so the lines must match how the issue will actually be completed. Not every
issue ends in a PR: a `type:question`/`type:decision` produces a decision/design doc and closes with
no PR, and a `type:chore` may be either a code change or an operational task `run` completes manually.

- **`type:feature`, `type:bug`** — always a PR:
  - `- [ ] Unit tests pass` ← only if `$HAS_UNIT_TESTS` is true
  - `- [ ] E2E scenario passes` ← only if `$HAS_E2E` is true
  - `- [ ] Code reviewed`
  - `- [ ] PR merged to main`
- **`type:question`, `type:decision`** — a decision, no PR:
  - `- [ ] Outcome documented (in the issue or a linked design doc)`
  - `- [ ] Any follow-up issues created`
  - `- [ ] Issue closed with the decision recorded`
- **`type:chore`** — code change *or* operational task (`run` decides at execution time), so keep the
  closing line neutral:
  - `- [ ] Unit tests pass` ← only if `$HAS_UNIT_TESTS` is true **and** the chore changes code
  - `- [ ] Code reviewed` ← keep it: a code chore should be reviewed; a manual chore skips review before this line is ever read
  - `- [ ] Done and the issue closed — via a merged PR for a code change, or confirmed complete for an operational task`

If the test flags are `unknown` (no profile), omit the test lines and keep the rest of the type's DoD.

**Labels.** Every sprint-ready issue carries:
- `type:` — one of `type:feature`, `type:bug`, `type:chore`, `type:question`, `type:decision` (required)
- `epic:` — if the item belongs to a recognisable theme (optional)
- `area:` — if the item has a clear technical layer: `area:infra`, `area:api`, `area:web`, … (optional)

Before creating an issue with an `epic:`/`area:` label, check the label exists in the repo and create
it if missing (announce each new label; the user approved it in the proposal table).

## 3. Sprint file format

`.context/sprints/sprint-N.md`:

```markdown
# Sprint [N]

**Goal:** [sprint goal]
**Demo:** [sprint demo — the watchable increment at sprint end; note if dev/CI-facing]
**Milestone:** #[milestone_number]
**Repo:** [owner/repo]
**Created:** [ISO8601 date, date only]
**Areas:** [area1 → area2 → area3]     ← omit this line if no area labels were found

## Issues

- [ ] #[N] — [title] ([labels: area:x, epic:y — omit if none])
[one line per issue, in execution order]
```

**Issue-line grammar.** Each line under `## Issues`, in execution order:

```
- [ ] #N — Title (area:x, epic:y) [⚠ unassigned] [✓accepted YYYY-MM-DD]
```

- `- [ ]` / `- [x]` — execution state. **Only `run` ticks the box**, on issue completion.
- `(labels)` — the issue's `area:`/`epic:` labels; omit the parentheses if none.
- `⚠ unassigned` — trailing annotation written by `plan`/`replan` when milestone assignment failed;
  readers strip it before parsing.
- `✓accepted YYYY-MM-DD` — trailing annotation written **only by `review`** when a human accepted the
  task (task-scope or sprint-scope review). `[x]` means *executed/merged*; `✓accepted` means *human
  signed off* — under autonomous execution these are distinct facts (a merged issue is closed on
  GitHub before anyone reviewed it). Sprint review walks only lines **without** `✓accepted`.

**Ordering.** Lines appear in execution order (the order `run`/`sprint` work them). The canonical
dependency pattern is `infra → api → web/mobile` unless issue content suggests otherwise; within an
area, explicit dependencies first, then issue number ascending; area-less issues last.

## 4. Rework issues

A rework issue records that a *shipped* task needs changes — the original stays closed/merged; the
rework is a fresh unit of work in the same sprint. Created by `/devloop:replan` (usually invoked from
`/devloop:review`):

- Body follows §1 with a trailing `Rework of #[N]` line (in place of `Derived from`), where `#N` is
  the shipped issue.
- After creating `#M`, post a backlink comment on `#N`: `Rework tracked in #M`.
- Label: same `type:`/`area:`/`epic:` as the original unless the feedback implies otherwise
  (a behavioral defect in shipped work is typically `type:bug`).
- The rework issue is assigned to the sprint milestone and appended to the sprint file per §3 —
  a flat sprint issue like any other (no sub-issue hierarchy); the cross-links carry the history.
