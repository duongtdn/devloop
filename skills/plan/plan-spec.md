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
- [ ] [outcome only a human can confirm] (manual)   ← only when it fails the "observable in the repo" check

## Definition of Done
[the lines from the DoD-by-type rule below]

Derived from #[backlog-A][, #backlog-B, …]   ← only when resolved from one or more backlog items
Rework of #[N]                ← only for a rework issue (see §4)
```

**Provenance.** `Derived from` records which backlog item(s) a task was drawn from — the relationship is
many-to-many: one task may synthesize several backlog items (list them all), and one backlog item may feed
several tasks (each cites it). A task authored directly from the sprint goal, not from any backlog item,
carries **no** `Derived from` line.

**Acceptance criteria rules.** They are the contract `run` reads to plan and validate the work, so:
- Each criterion is a single user-visible or testable outcome, phrased as a checklist item.
- Aim for 2–5 per issue. Cover the happy path and the obvious failure/edge cases the item implies.
- Do not invent scope the source item does not imply. If it is too vague to derive criteria, ask the
  user rather than padding.

**Satisfiability — the four checks.** `run` ticks an AC only when a passing test covers it **and** a
production call path reaches it; anything else is recorded unmet and the issue cannot close cleanly. An
AC drafted from what the source item *says*, without asking whether *this issue* can make it true, is
how a sprint ships issues that can never pass validation. Every AC must pass all four:

1. **Closed by this issue.** This issue's own change — on top of the issues **ordered before it** —
   makes the AC true. An AC that needs a later issue (the UI that calls this API, the route that mounts
   this middleware, the job that feeds this table) belongs to that later issue. Move it there, or split.
   **Never** keep it here with a "wired up later" understanding: `run` validates one issue at a time
   and will find *nothing calls it*.
2. **Reachable.** The AC names behaviour observed through a real entry point — an HTTP route, CLI
   command, exported package API, scheduled job, rendered screen — not a symbol existing in isolation.
   For a genuine library/infrastructure task, name the caller that exercises it in this issue ("the
   login handler rejects an expired token via `verifyToken`"), not "`verifyToken` exists".
3. **Observable in the repo.** A test or code trace can prove it. An outcome only a human or an outside
   environment can confirm — an email landing in a real inbox, behaviour on staging, production load,
   third-party credentials, "feels clear" — is legitimate but must be written with a trailing
   **`(manual)`** so `run` treats it as a manual check from the start instead of failing it as an
   automated one. **Never** phrase an unobservable outcome as if a test could prove it. Unmeasurable
   words — *fast*, *secure*, *robust*, *intuitive*, *all errors* — need a concrete threshold or case, or
   they come out.
4. **Fits the type.** A `type:question`/`type:decision` issue closes with no PR, so its ACs describe the
   decision recorded (options compared, choice and reason written down, follow-ups filed) — **never**
   code behaviour, which no decision can satisfy. A code-behaviour AC on such an issue means it is really
   a `feature`/`bug`/`chore`, or the AC belongs to the follow-up.

Two more sources of ACs that cannot be met:
- **Contradicting an accepted ADR.** If `.context/decisions/index.md` exists, scan it before drafting and
  open any ADR whose hook line touches the issue's area. An AC an ADR forbids is unmeetable without
  superseding the ADR — raise the conflict to the user; **never** draft around it silently.
- **A stale premise.** A bug or "change X" item may predate the code. When an AC rests on a named file,
  symbol, route, or message, one `Grep` confirms it still exists. If it is gone or renamed, ask the user
  rather than drafting criteria against code that is not there. One check per named thing — this is not
  a context-gathering phase.

**Across issues.** ACs in one sprint must not contradict each other (#42 "invalid token → 401" vs. #43
"invalid token → redirect to login"), and no single issue carries the **sprint demo** as its AC — the
demo is the composition of the sprint's issues, which no one issue can satisfy.

**Right-sizing.** A sprint issue should be a unit of work worth tracking on its own — neither a
multi-day epic nor a one-line edit. **Split** an item that covers several independently-shippable
concerns (Step 3 already does this for backlog items; apply the same judgment to gap-fill tasks).
**Don't** mint a standalone issue for a change too small to warrant one — a typo, a single comment,
a one-line doc tweak — **fold it into the most related issue** unless it is genuinely independent and
must be tracked separately. (Execution *weight* is a different axis and already handled downstream: a
legitimately small standalone issue runs cheaply — `run`'s planner sizes it to the lightest rung
(`TRIVIAL` for an inert docs edit, `EXPRESS` for a trivial code change), so a small issue is never an
expensive one. Right-sizing here is about whether the work deserves its *own line in the sprint*, not
about how heavily `run` executes it.)

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
