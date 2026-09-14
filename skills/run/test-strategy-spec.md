# Test strategy spec — what to prove, and how

The single source of truth for **deciding what gets a test**. Read by the `planner` (writes
`test-plan.md`), the `test-critic` (judges it), the `test-writer` (encodes it), `/devloop:run` (plan gate,
build, validate) and `/devloop:tinker` (§ 3 for direct changes, the planned path for bigger ones). The
rules that bite are restated at each write site; this file owns the reasoning behind them.

A test is not free. It is suite time on every run, a file every later change must keep green, and a
claim — *this is covered* — that everyone downstream trusts. A test that pins something nobody needed
pinned costs all three and proves nothing a person would not have seen in ten seconds. A test plan
that misses the empty-list case costs more: it is green, reviewed, and wrong. This spec exists to push
against both at once — **fewer tests where a person's eyes are the better proof, and more cases where
the behaviour carries real risk.**

---

## 1. Purpose first — reason from the project, never match a word list

Before deciding any proof, read what the work is *for*. The signals come from the user's project, so
they are **read and reasoned about, never matched against a fixed vocabulary**:

- the issue's **title, labels, body and acceptance criteria**, and its comment thread (`context.md` Zone 1
  → *Purpose signals*);
- the **sprint goal** and the sprint **`Demo:`** line;
- in `tinker`: the session goal, the instruction's own words, the track (`vibe` vs sprint);
- **journal facts** for the area — *"shipped observe-only as a trial"* is a reason to re-decide now.

A label `prototype`, a title *"Try out a sign-in with Google"*, a demo line *"the owner clicks through
the onboarding and says whether it feels right"* are **examples** of what a signal looks like, not a
list to search for. A project may say it in its own words, in any language, or in a label nobody else
uses.

Settle two things:

| Question | Answers |
|---|---|
| **Lifetime** — will other code, other people, or real users rely on this as it is? | `durable` · `trial` (built to be shown or tried, expected to change with the reaction) |
| **Who judges it correct** — for each behaviour | our code's rule (data, a decision, a contract) · a person looking at it (layout, copy, flow feel, pacing) |

- **Cite the evidence.** The reading goes in `test-plan.md`'s `## Purpose` with each signal quoted and
  its source. A reading nobody can check is a reading nobody can correct.
- **No signal → `durable`.** Never infer *trial* from the absence of a signal: the cheap mistake is one
  extra test, the expensive one is an untested rule that shipped because nobody said it mattered.
- **Conflicting signals** (a `prototype` label on an issue whose AC is a payment rule) → say so in the
  reading; the risk rule in § 2 wins either way.

---

## 2. The proof decision — per behaviour, not per task

A task can hold several behaviours; each gets exactly one proof:

| Proof | Means | Recorded as |
|---|---|---|
| **`test`** | an automated test, red-verified before the code exists | scenarios (§ 3) |
| **`observe`** | a person checks it in the running app — the check is written down, and someone confirms it | a check: *do this → see that* (§ 5) |
| **`none`** | nothing to prove that we own | the one-line reason |

Walk in order; **the first row that fits decides**:

| # | The behaviour | Proof |
|---|---|---|
| 1 | A mistake would cost something **a demo would not show**: data lost or corrupted, money, authentication or permission, secrets, anything irreversible, or a **contract other code or other people consume** (an API, a schema, a migration, a message format) | **`test`** — whatever the purpose. A trial that writes to a real database is not a trial for its data. |
| 2 | Any assertion would **only restate a value** (a colour, a label, a tuned delay), or would hold because the **language, a library, or a mock** behaves as documented | **`none`** — name whose decision it is. Where our code only configures a library and a boundary exists (this input reaches that handler, gets that response), row 5 applies to the boundary instead. |
| 3 | Correctness is **judged by a person looking at it** — layout, wording, a flow's feel, an animation, what a demo path shows — and a test would pin the current rendering, not a rule | **`observe`** |
| 4 | Purpose is **`trial`**, the behaviour is our rule, but getting it wrong is **cheap and visible** the moment someone tries it | **`observe`** — and write *promote to test when:* (it stops being a trial, other code builds on it) |
| 5 | Anything else: a rule, a branch, a response, a state change our code decides | **`test`** |

**The count follows risk, not structure.** A plan with five tasks does not need five tested behaviours;
a plan with one task over a permission rule may need six scenarios. Never write a scenario because a
task exists — that is a filler test, and a filler test is trusted forever.

---

## 3. Covering a `test` behaviour — the edges

A `test` behaviour gets its **happy path**, then its edges. Walk this list against the behaviour's real
inputs and dependencies; **skip silently a row that does not apply**, write a scenario for a row that
does, or list it under **Not tested** with the reason:

- **Boundaries** — empty, zero, one, the maximum, just past a limit
- **Absent or invalid input** — missing, malformed, the wrong shape at a runtime boundary our code guards
- **A dependency failing** — the call our code makes errors or times out, *where our code decides what happens next*
- **Who is asking** — another user's resource, no session, a lesser role — where the behaviour has an owner
- **State** — called twice (idempotency), already in the target state (a used link, a closed order), out of order
- **Concurrency** — only where the code shares mutable state; otherwise skip the row

Three rules keep the list from becoming padding:

- **Each scenario must be able to fail because *our* code is wrong.** The test: would it still pass if
  the code this task adds were deleted? Then it asserts the language, a library, or a mock's own setup —
  rewrite it at our boundary or drop it.
- **One scenario per distinct outcome.** Three values that take the same branch are one scenario; a value
  on each side of a limit is two, because the limit is the branch.
- **Not tested is honest, not a failure.** An edge that applies and is deliberately left untested, with
  its reason, is information the human and the reviewer use. An edge that silently vanished is not.

---

## 4. `test-plan.md` format

```markdown
# Test plan — <issue #N | tinker ref>

## Purpose
- **Reading:** durable | trial — [one line]
- **Evidence:** "[quoted signal]" (issue title) · "[quoted signal]" (sprint Demo) — or: no signal, treated as durable

## Unit                              ← include only if $HAS_UNIT_TESTS is not false
### Task 1 — [title]
#### [behaviour, in terms of what our code decides]
- **Proof:** test
- happy: given … when … then …
- edge: given … when … then …
- error: given … when … then …
- **Not tested:** [the edge] — [why]          ← omit when none

#### [behaviour]
- **Proof:** observe — [why a person's check is the right proof]
- check: [what to do] → [what they should see]
- promote to test when: [the condition]       ← trial only

#### [behaviour]
- **Proof:** none — [whose decision it is, or what an assertion would only restate]

## E2E                               ← include only if $HAS_E2E is true AND there are user-facing flows
### Flow — [name]
- **Proof:** test | observe — [why]
- [scenario, or the check for observe]
```

- **Every task has at least one behaviour with a `Proof:` line.** A task whose behaviours are all
  `observe` / `none` is legitimate — it is built without a failing test, by recorded decision.
- A task with **no behaviour at all** is not a task; it is a step of the task it serves — fold it in.
- Scenarios are written in behaviour terms. **Never a plan task number** in a scenario — tests outlive the plan.

---

## 5. Where an `observe` proof lives

- **Not in `.context/devloop-unproven.md`.** That ledger means *a test was due and was overridden*, and
  `/devloop:review` and `/devloop:plan` offer every row back as test work. An `observe` decision there
  would return as the very test the plan decided was not worth writing.
- **`run`** — validate lists each check as a manual check (human mode) or carries it as a `needs manual
  verification` flag (auto mode), which `/devloop:review` puts first in its demo recipe.
- **`tinker`** — the human tries it at the change's gate; Zone 2 records `Proof: observe — <what they checked>`.
- **The journal** — when a behaviour shipped `observe` *because it was a trial*, the line's *why* says so,
  so a later issue that makes it durable re-decides instead of inheriting the decision.

---

## 6. Tests written after the code

A red check proves a test is meaningful **only when the code does not exist yet**. Where a test is
written against code that already exists — e2e flows written after the build, coverage for a surface a
review fix created — `red` would come back `GREEN` on every good test. Those tests are verified by
running them (`test-runner` `unit` / `full`), not by `red`. They are the weaker kind; that is one more
reason § 2 does not ask for them by default.

---

## 7. Never

- Never write a scenario to fill a task's slot.
- Never mark a behaviour `observe` or `none` when row 1 of § 2 applies.
- Never read *trial* from silence.
- Never add a scenario beyond the plan in the `test-writer` — the plan (after critique) is the contract.
- Never write an `observe` check into the unproven ledger.
