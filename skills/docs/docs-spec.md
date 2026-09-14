# Docs spec — the human-facing doc tree

Shared spec. Read by `/devloop:docs` (every invocation), the `surveyor`, the `doc-writer`, and the
`doc-critic`. It owns three things: the **map format**, the fixed **architecture skeleton**, and the
**tone contract** every document is written to.

Each consumer adds its own preconditions and its own recording. Nothing here overrides those.

---

## Why this tree exists

Everything else devloop writes is **transactional** — anchored to an event, append-only,
chronological:

| Artifact | Anchored to | Shape |
|---|---|---|
| `devloop-journal.md` | an episode | history |
| `context.md` Zone 2 | an issue | timeline |
| `decisions/` | a decision | case law |
| `sprint-N-review.md` | a sprint | retrospective |
| `design.md` | one issue's design | superseded by the next issue |

Not one of them answers **"what is this system, right now?"** — and you cannot reconstruct it by
reading all of them, because they are additive. Knowing the current state would mean replaying every
episode and applying the deltas in your head.

The AI never notices, because the `context` agent rebuilds a task-shaped slice of that answer from
scratch on every issue, uses it, and throws it away. A human cannot. **That asymmetry is the drift**
this tree exists to close: after six sprints the humans are reasoning about a system that no longer
exists, and a new developer has nothing to join.

So: **the journal is episodic memory, the ADR index is law, and this tree is the standing
description.** It is the one document class devloop has never had.

**It is not an API reference** (derivable from the code, and `typedoc` already does it better) and
**not a per-file comment pass**. It holds only what cannot be read off any single file.

---

## Where things live

| Path | What |
|---|---|
| `docs/` (or the recorded root) | **the human's tree** — clean prose and diagrams, no machine metadata |
| `.context/docs-map.md` | devloop's control file for that tree: nodes, coverage, provenance |
| `.context/docs-audit.md` | the last audit report — a snapshot, overwritten each run |

`.context/` is the machine's memory; the doc root is the human's. Nothing in the doc tree carries
frontmatter, ids, timestamps, or coverage globs — **all bookkeeping lives in the map.** A reader
opening `docs/backend/auth.md` sees a document, not a record.

---

## The map

One file. Six sections, in this order. It is small enough to read every time — the same shape as
`decisions/index.md`, which is the one retrieval surface in this plugin that already works.

Unlike the journal and the ADR index, **this file mutates** (`Status`, `Based-on`, `Confirmed`).
That is what the permanent node ids are for: `### D-006 ·` is unique by construction, so an `Edit`
lands where it was aimed. In a file of forty similar-looking blocks, nothing else is.

````markdown
# Docs map

Root:       docs/
Branch:     main
Diagrams:   mermaid
Surveyed:   a1b2c3d · 2026-09-05
Last audit: 2026-09-05 → `.context/docs-audit.md`

<!-- devloop's control file for the human doc tree. Node ids are permanent and never reused. -->

## The tree

docs/
├─ README.md ............. D-001  start here — what this system is, and how to read these docs
├─ architecture.md ....... D-002  the whole system in one picture: the parts, their boundaries,
│                                 and one real request traced end to end
├─ onboarding.md ......... D-003  get it running on your machine and land one change
├─ development.md ........ D-004  where new code goes, the conventions, how to add a new X
├─ backend/
│  ├─ README.md .......... D-005  the services, and which one owns what
│  ├─ auth.md ............ D-006  how a request gets authenticated
│  └─ payments.md ........ D-007  the payment flow and its external contracts
└─ data/
   ├─ model.md ........... D-008  the entities and how they relate
   └─ migrations.md ...... D-009  how a schema change ships safely

## Deliberately not documented

- **Per-endpoint request and response shapes** — generated from the schema; changes every sprint.
- **`src/internal/experiments/**`** — rebuilt continuously; any description would be wrong before
  anyone read it.

## Nodes

### D-006 · docs/backend/auth.md

Covers:    `src/auth/**`, `src/middleware/session.ts`
Reader:    a developer about to change how sign-in works
Sources:   ADR-003, ADR-007
Origin:    devloop
Status:    written
Based-on:  a1b2c3d · 2026-09-05
Confirmed: —

## Log

- 2026-09-05 · map created from survey · 9 nodes
- 2026-09-12 · D-011 added (`docs/backend/notifications.md`) · the notification service landed in
  sprint 4 and the coverage check flagged it uncovered
- 2026-09-20 · D-007 split into D-007 + D-014 · the payments doc had grown to cover two unrelated
  external contracts and nobody could find either
````

### The preamble

| Field | What goes in it |
|---|---|
| `Root:` | where the tree lives, relative to the repo root. **Recorded, not inferred** — an invocation with no argument writes to *this*, never to a default, or the second run builds a second tree. |
| `Branch:` | the line of development these docs describe. Confirmed by the human once, at map creation. |
| `Diagrams:` | `mermaid` (default) or `ascii`. |
| `Surveyed:` | the commit the structure was last derived from, plus its date. |
| `Last audit:` | date and path of the last report. |

### The tree section

**The hook line is the node's Question**, written once, here — the node record does not repeat it.
This section is what the human reads at the map gate, so it must be readable on its own: a tree, one
line each, no ids doing work the words should do.

**Every node is a doc.** A directory exists only because some doc has children — `backend/README.md`
is a node like any other. One concept, not two.

### Deliberately not documented

The NOT list, and it carries real weight. The stop rule below generates *decisions*, and an
unrecorded decision is re-litigated at every refresh — worse, a reader cannot tell "we chose not to"
from "nobody thought of it". Each entry names what and **why**.

This is also the audit's suppression list: a path named here never reports as a coverage gap.

### The node record

| Field | Grammar | Notes |
|---|---|---|
| `Covers:` | backtick-quoted globs, comma-separated | the code this doc describes. Drives staleness and coverage. |
| `Reader:` | one line | who opens this and what they are about to do. The only field the tree does not already carry. |
| `Sources:` | ADR ids, issue numbers, `—` | a second staleness channel: when ADR-007 is superseded, this is how you find the docs written under it. |
| `Origin:` | `devloop` \| `adopted` | `adopted` = a pre-existing human-written file. **Never overwrite an adopted doc** — propose a diff, or leave it alone. |
| `Status:` | `pending` \| `written` \| `adopted` | what the map *asserts*. Deliberately no `stale` — staleness is *computed*, and if it lived here the audit would have to write to the map. |
| `Based-on:` | `<sha> · <date>` | the commit this doc describes. The SHA is the cursor; the date is the fallback when the SHA is unreachable. |
| `Confirmed:` | `<date>` \| `—` | a human read this doc and it matched the system. `—` is the honest common case. |

**A node exists if it can state a Reader and a Question, and has real content today.** Nothing else
qualifies it. A doc that would have to be padded is a doc that should not exist yet — leave it out,
and let the map grow with the system through the amend path.

### The Log

One line per structural change, with its **why**. The tree says what the map is; only the log says
why it stopped being what it was. Append; never rewrite a line.

---

## Staleness and coverage — how they are computed

Both fall out of the recorded SHAs plus git. Neither needs an agent.

**Is this doc stale?**

```
git diff --name-only <node Based-on sha>..HEAD -- <the node's Covers globs>
```

Non-empty means the code moved under the doc. The journal then supplies the *why* for those commits,
where it has a matching entry — but the diff is the source of truth, and deliberately so: the journal
records only devloop episodes, so a hand fix on main, a teammate's merge, or anyone on the team not
running devloop is invisible to it. Those are exactly the changes a growing team accumulates.

**Is anything uncovered?**

```
git diff --name-only <Surveyed sha>..HEAD
```

Collapse to directories. Anything matched by no node's `Covers:` and not named in *Deliberately not
documented* is a coverage gap. New source areas are precisely what that diff surfaces.

**When the SHA is unreachable** (a shallow clone, a rewritten history), fall back to the date cursor
and the journal's `areas`, and say in the report that the check ran degraded. Never report a doc as
fresh because the check could not run.

---

## `docs/architecture.md` — the fixed skeleton

**This one document has a fixed shape**, deliberately unlike the tree. The tree is reasoned per
project because systems differ; the orientation document is fixed because its job is to be the same
questions in the same order in every project. A per-project orientation shape defeats orientation.

Six sections. Sections 1–5 always have content at any project size. Section 6 appears when there is
somewhere to go.

### 1. What this system is

Three to five sentences, in **system** terms: "a CLI that reads X and produces Y", "three services
behind an API gateway, serving a React client". No technology adjectives, no feature list.

Where `.context/product-brief.md` exists, **link it and do not copy it** — that document is what the
product *is*, from the owner's side, and two copies drift with nothing to catch it.

### 2. The shape

A diagram of the parts, followed by a table binding every box to real code:

| box | is | lives in |
|---|---|---|
| gateway | routes and authenticates every request | `src/gateway/**` |
| payments | talks to Stripe, owns the ledger | `src/payments/**` |

**The table is the load-bearing half, not the picture.** A diagram whose boxes bind to nothing reads
as authoritative, ages invisibly, and cannot be checked. With the table, every box is falsifiable by
one glob — and those globs are what the child nodes' `Covers:` are built from.

### 3. One thing happening, end to end

The section that actually teaches. A structure diagram teaches names; a traced journey teaches how
the thing works and lets a new developer locate where their change goes.

**Pick the flow the product brief's scenario names.** It is the one journey a human has already
agreed is representative. With no brief, take the entry point with the most traffic.

Not every system has a request. What qualifies varies — a request, a CLI invocation, a batch run, a
plugin lifecycle, a build. **One is the target; three is the hard cap.** More than that is a tour,
and a tour is what this section exists instead of.

Sequence diagram, then numbered steps: **one claim per step, each with a narrow citation.**

```
1. `POST /checkout` arrives at the gateway → `src/gateway/routes.ts:44`
2. the gateway validates the session       → `src/auth/session.ts:112`
```

End with **`Proved by <test>`** where a test exercises the flow. A walked journey and an observed one
are indistinguishable on the page — the citation is what converts a reading into evidence. Where no
such test exists, say so plainly; the absence belongs in the most-read document in the repo.

### 4. The boundaries that matter

The rules that hold the system together, what breaks if you cross one, and — the half nobody writes
down — **whether anything actually stops you.**

```
- **Only `payments/` touches the database.** ADR-007.
  Enforced: a lint rule on imports. Cannot see: a service reaching the DB over HTTP.

- **The gateway holds no business logic.** ADR-003.
  Enforced: nothing. Convention only — caught in review or not at all.
```

This is the ADR's **enforcement blind spot** surfaced where a developer will actually meet it. Right
now they learn which rules are real by having a PR rejected. "Convention only" is not an admission of
weakness; it is a different and useful fact from both "enforced" and "no such rule".

Quote the one binding sentence of an ADR and link the rest. Never restate a decision.

### 5. What this system deliberately does not do

The brief's NOT list at system altitude, and load-bearing for the same reason: it is the most
falsifiable section on the page, and the one that stops somebody building a thing that already exists
somewhere else.

### 6. Where to go next

An ordered reading path into the tree and into the ADRs, each with the occasion that sends you there
("changing sign-in → `backend/auth.md`"). Not a link dump.

### Budget

**Ten minutes to read — roughly 150–250 lines.** Not a style preference: it is the pressure that
pushes detail into the tree. A 900-line architecture document is not comprehensive, it is a tree that
failed to form.

---

## The stop rule

**Stop descending when the next level down would describe things that change every sprint.**

Above that line, documents are slow-moving and worth maintaining. Below it, the code is the
documentation and the `context` agent rebuilds what is needed per task anyway.

That is also why there are no class diagrams and no API reference: they sit below the line. The rule
decides it; neither has to be banned by name.

---

## The tone contract

These documents inherit the conversational skills' talking contract (`skills/review/SKILL.md`
§ *How to speak here*), moved from speech to page. The problem is the same and worse: a writer
holding a full model of the system produces prose that is accurate, complete, and unfollowable — and
unlike a conversation, the reader cannot even say "ok" to move it along.

1. **One idea per paragraph. Four sentences maximum.**
2. **Draw first, then describe.** A picture after the explanation is decoration; the same picture
   before it is what lets the explanation be short.
3. **Choose the visual to the content.** A structure gets a diagram, a set of rules gets a table, a
   sequence gets numbered steps. Forcing a diagram onto a list is a wall in a different costume.
4. **Ground before judgment.** No name may appear in a claim before one plain line says what it is —
   **including the parts that were already there.** The reader is judging a system, not a diagram of
   boxes.
5. **Plain sentence first, technical label second or not at all.** Two vocabularies get translated:
   devloop's (*rung*, *Zone 2*, *gate*, *phase* — these never appear) and generic architecture-speak
   (*coupling*, *seam*, *layer*, *abstraction*). "Only the payments service talks to the database"
   leads; the label follows it or is dropped.
6. **No hedging.** *Generally*, *typically*, *should probably*, *may*. This is a document about one
   specific codebase — either it is true here or the writer did not check. **A hedge is a signal to
   go look, not a way to finish the sentence.**
7. **No filler openers.** "In this section we will discuss…" — cut, always.
8. **Second person in the how-to documents.** "You'll find it in…" is shorter and more concrete than
   the passive.
9. **No wall longer than ~15 lines** without a diagram, table, or list. A section that cannot be
   broken up is covering two things.
10. **Every claim carries its citation inline**, as a path — not footnoted. It is what makes the
    sentence checkable, and it doubles as the reader's next click.

The difference this makes:

> ❌ The authentication subsystem provides a flexible, extensible abstraction over multiple identity
> providers, allowing the system to support various authentication mechanisms while maintaining a
> clean separation between the transport layer and the underlying credential validation logic.

> ✅ Sign-in is handled in `src/auth/`. It supports Google and email links today, and each one is a
> small file in `src/auth/providers/`. Adding a third means adding a file there and registering it in
> `providers/index.ts:12`.

Same subject. The second one you could act on.

---

## Diagram conventions

Set by `docs/architecture.md` and inherited by every child — not by magic, but because **the
architecture document is an input to every leaf commission**, the way `design.md` is to the coder.

- **Node names are canonical.** A box called `auth` in the shape diagram is `auth` in every child
  document. Names come from the code, never invented in prose.
- **Diagram type per job**: `flowchart` for shape, `sequenceDiagram` for a flow, `erDiagram` for
  data, `stateDiagram` only where a real state machine exists. **No class diagrams.**
- **~7 nodes at any one altitude.** More means the detail belongs to a child document. This is the
  forcing function that makes the tree form instead of one document swallowing the system.
- **Every diagram is followed by a gloss** binding its nodes to real paths. No exceptions — a diagram
  is a set of claims.
- Dependencies point one way and are drawn one way, consistently.

---

## Never

- **Never fabricate a path, symbol, or module.** Every path, symbol, box, and citation resolves
  against the repo or it comes out. This fails the way a guessed MCP tool name fails rather than the
  way a missing file does: silently, with confident, fluent, wrong output — and here it is worse,
  because the reader has no way to check and every reason to trust.
- **Never write adjectives as architecture** — *clean*, *modular*, *loosely coupled*, *scalable*.
  Unfalsifiable, and they are the reviewer's excluded judgments wearing prose.
- **Never write a directory tour.** "`src/` contains the source code" is a table of contents, not
  understanding.
- **Never write aspirations.** "We plan to extract the ledger" is a plan, and by `architect`'s Gate 1
  a plan is not a standing constraint — it belongs in `backlog`.
- **Never write history.** How it came to be this way is the journal's job. This tree says what is.
- **Never restate an ADR, the brief, or another document.** Quote the one binding line and link.
- **Never overwrite a file whose node says `Origin: adopted`**, or any file not in the map.
- **Never pad a node** to fill a shape.
