# Field report — "green but unreachable": a defect class the inner loop does not gate

**Date:** 2026-07-13
**Reporter:** outer loop (`/devloop:review`, sprint scope), Stemolly Sprint 1
**Project:** `stemolly/project` — 8 issues, autonomous execution (`run --auto`), 4 reviewed at time of writing
**Status:** two independent instances shipped to `main`, both green, both caught by a human at outer-loop review

---

## Summary

Two of Sprint 1's four reviewed issues shipped a defect of the **same shape**, and **no inner-loop gate fired on either**. Both passed unit tests, typecheck, lint, `depcruise`, the `reviewer` pass, and the `critique` pass. Both were caught only when a human ran the real code at outer-loop review.

The shape:

> **An artifact is verified against a stand-in instead of against the real producer or consumer it exists to serve. The test and the code agree perfectly with each other, and disagree with the system.**

This is not "the tests were bad." Both test suites are well-written and prove exactly what they claim. The problem is that **what they claim is not what the acceptance criterion asserts** — and no gate in the loop is positioned to notice the difference.

I want to flag one instance in particular as the more dangerous of the two, because it is the one the loop is *least* equipped to see: **a module that is fully implemented, fully tested, green, and called by nothing.**

---

## Case 1 — a resolver that nothing resolves through (issue #13)

`llm/domain/tiers.ts` exports `resolveTier(tier, purpose) -> ModelConfig`: the tier registry's core `(tier, purpose) → {model, rate}` resolution. Its own doc comment states it "throws on an unregistered `purpose` (G-6's 'throw, not warn' posture) rather than silently falling back to a default model." It has a passing unit test asserting exactly that (`tiers.test.ts:47`).

**`resolveTier` is never called from any production code path.** Its only references in the entire tree are its own definition and its own test file.

What runs instead: the adapter builds its model via `resolveHarnessModel(config)`, which dispatches on `config.provider` alone. So `tier` and `purpose` have **zero influence on which model is actually invoked** — `tier: 'strong'` does not select a strong model. `tier` survives only as a lookup key into a deliberately purpose-agnostic flattened rate table.

Reproduced live at review, through the real gateway:

```
llm.complete({ tier: 'fast', agentRole: 'analyst', purpose: 'summarize-essay',  // never registered
               promptId: 'echo-turn', promptVersion: '1', vars: {} })

→ metering.llm_calls row: {"purpose":"summarize-essay","tokens":2,"cost":0.004}   ← billed, not rejected
```

The guardrail exists, is tested, is green, and is unreachable.

The issue's AC1 — *"Tier registry resolves fast/strong per purpose"* — was marked satisfied by `validate` because a passing test covers it. It is satisfied **as a library function**. It is not satisfied **as a behavior of the running system**, and nothing in the loop distinguishes those two readings.

Tracked as `stemolly/project#23`.

## Case 2 — a schema that could never validate its real input (issue #12)

`LogFieldsSchema` (zod, `.strict()`) was authored to pin the structured-log field set. It required `timestamp` and `level` as **strings**.

The real `createLogger()` — untouched by the task, per its own plan — emitted pino's defaults:

```json
{"level":30,"time":1783955715230,"pid":207527,"hostname":"Work", ...}
```

Numeric `level`. Epoch integer under a `time` key, not `timestamp`. Plus `pid`/`hostname`, which `.strict()` rejects outright. **The schema could not have validated a single real log line.** The suite was green throughout, because the tests fed the schema only (a) hand-built sample objects and (b) a specially-reconfigured in-memory logger — both constructed by the tests themselves.

Schema and fixture drifted together, in agreement, away from the production logger.

This one *was* caught — by the `reviewer` (finding F1, upheld by `critique`, which re-verified it by running real pino in a subprocess). Credit where due. But note **how narrowly**: the reviewer caught it by *empirically running the real logger*, which is not something its rubric asks it to do, and is not something it can do for every artifact in every diff. It got lucky on a small diff. Case 1, in an 11-task diff, it missed.

---

## Why every gate slept through this

| Gate | Why it cannot catch it |
|---|---|
| **unit tests / test-red** | Verify a function against **its own contract**. `resolveTier` works; the test proves it works; it passes. A unit test is *structurally incapable* of noticing the function has no callers. Wrong instrument, not a badly-aimed one. |
| **`depcruise`** | Polices that dependencies which **exist** are legal. It has nothing to say about dependencies that **should exist and don't**. It checks edges, not absences. |
| **typecheck / lint** | An exported symbol with no importers is valid TypeScript and (by default) unlinted. |
| **`reviewer`** | Reads a diff. In a diff where `tiers.ts` and `tiers.test.ts` both appear — freshly written, green, well-documented — the module **looks complete**. Nothing in the diff announces "and nobody imports this." |
| **`critique`** | Judges the reviewer's findings. If the reviewer never raised it, the critique never sees it. It is a second opinion on what was found, not a second search. |
| **`validate`** | **The gate that was actually in position, and asked the wrong question.** |

### The `validate` phase is the root cause

`skills/run/SKILL.md:562`:

> - **Automated ACs / DoD** (test-backed): mark satisfied from the latest `test-runner` results and the completed review.

An AC is marked satisfied **because a test covering it passes**. That inference is exactly the one that breaks here. "AC1: the tier registry resolves fast/strong per purpose" has a green test; `validate` ticks it; the resolution never happens in the running system.

`validate` asks: *"is this AC test-backed?"*
It should ask: *"can I trace this AC to a production call path?"*

That single change catches **both** cases. For #13 it asks "which production code path calls `resolveTier`?" — answer: none. For #12 it asks "which production code path emits a line that `LogFieldsSchema` validates?" — answer: none, the only validated lines come from test-built objects.

### `reviewer`'s `test-pass-insufficient` dimension is close — but aimed elsewhere

`agents/reviewer.md` already carries the right *instinct*, in a dimension explicitly framed as **"what could be wrong here that running the tests would not reveal?"** That is precisely the question. But its enumerated list is entirely about **runtime nondeterminism** — concurrency, races, ordering, resource lifecycle, idempotency, reversibility. Every item is a case where *the code runs* but takes a lucky path.

**It has no item for code that does not run at all.** Reachability and wiring are a different failure mode from a race, and the list as written does not point the reviewer at them.

(Notably, the same file already argues that test helpers deserve production rigour because a bad helper "actively vouches for broken code" — that is *this* insight, one step short of its conclusion. A test that only ever feeds an artifact stand-in inputs vouches for the artifact just as falsely.)

---

## Proposed changes

Ordered by how directly each closes the gap. (1) is the primary — it is the gate that was in position and asked the wrong question.

### 1. `validate` must trace ACs to a production call path, not to a passing test

**File:** `skills/run/SKILL.md`, the `## Phase: validate` section (~line 562).

Change the automated-AC rule from *"mark satisfied from the latest `test-runner` results"* to a two-part check:

> - **Automated ACs / DoD** (test-backed): an AC is satisfied when a passing test covers it **and** the behavior it asserts is reachable from a production entry point. For each AC, name the production call path that exercises it (the composition root → module → the symbol under test). If the only callers of the symbol an AC rests on are its own tests, the AC is **not** satisfied — the artifact is green but unreachable. Record the traced path in the Zone 2 validation entry; where no path exists, treat it as an unmet AC (block, or in auto-mode carry it forward as a flag — never tick it silently).

The cost is one grep per AC. The Zone 2 record it produces ("AC1 → `composition.ts` → `llm/index.ts` → `createCompletePolicy` → …") is independently valuable at outer-loop review, where today the human has to reconstruct it by hand — which is exactly how both of these were found.

### 2. Extend `reviewer`'s `test-pass-insufficient` list with a reachability item

**File:** `agents/reviewer.md`, the `### The test-pass-insufficient dimension` bullet list.

Add:

> - **reachability / wiring** — code that is never executed by the system at all: an exported symbol whose only callers are its own tests; a guard, validator, or resolver that the real call path bypasses; a schema or contract validated only against fixtures the tests themselves construct, never against the real producer's output. A green test proves the artifact *works*; it does not prove anything *uses* it. When a diff adds a module **and** its tests, ask who calls it in production and name them — if the answer is "only the test," that is a blocker-class finding, not a nit.

This gives the reviewer the standing instruction it lacked. It would have caught #13 (`grep resolveTier` → only its own test) at review time, cheaply.

### 3. A reachability fitness function (mechanical backstop)

**Where:** the project's CI rails (`G-*` fitness functions), not devloop itself — but devloop's `scaffolder` could seed it, the way it seeds the other rails.

Fail CI on an exported symbol in `domain/`, `src/**` (excluding barrels and entry points) whose only importers are `*.test.ts`. Off-the-shelf: `ts-prune`, `knip`, or `eslint-plugin-unused-imports` in strict mode.

This is the cheapest and most reliable of the three — it would have caught #13 outright, with zero judgment involved. It would **not** have caught #12 (the schema *was* imported and used; it was validated against the wrong inputs). Hence it is a backstop, not the fix.

---

## What I am not claiming

The loop is not weak. In the same sprint it caught four defects a human reading the diff would almost certainly have missed:

- a pnpm crash on `"dependencies": null` in a published harness package — and it **refused** two workarounds (a major pnpm bump, a `node_modules` edit) as decisions not its own to make, restored the repo to clean, and escalated (#13, task 1)
- a `dynamic import()` bypass in the G-2 vendor-confinement rail — a hole in a security gate, found by `reviewer` (#13, R1)
- metering-write failures silently swallowed by a bare `.catch(() => {})` (#13, R3)
- two independent testcontainer leaks on error paths, both upheld by `critique` (#14, R2/R3)

It is a good loop with a **specific, nameable blind spot**: it verifies artifacts against themselves, and never asks whether the system actually uses them.

The blind spot is worth fixing precisely *because* the rest of the loop is strong. A gate that catches four real bugs earns trust — and that trust is what lets a green, unreachable module sail into `main` with a tick beside its acceptance criterion.

---

## Provenance

Every claim above is traceable to on-disk artifacts in `stemolly` (paths relative to the umbrella repo):

- `.context/sprints/work/issue-13/context.md` — Zone 2, `[2026-07-13T15:51:30.026Z] · review · acceptance` (the gap, the live repro, the verbatim process question that prompted this report)
- `.context/sprints/work/issue-12/context.md` — Zone 2, reviewer F1 + critique entries (the schema case, and the subprocess verification)
- `.context/sprints/work/issue-13/run-state-final.md` — the task-1 stop-the-line and the review/critique record
- `stemolly/project#23` — the backlog issue tracking Case 1's fix

The human's question that triggered this report, verbatim:

> *"Do you think the inner loop need to be improved to catch similar error (not that anyone uses a green module)."*
