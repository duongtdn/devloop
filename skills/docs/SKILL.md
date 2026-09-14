---
description: "Build and maintain the documentation humans read — architecture, onboarding, development guide, per-component docs — derived from the code itself and kept honest against it. Run it bare to audit: it tells you which documents the code has moved out from under, using the commit each was written against, and which rules the docs claim that the code no longer obeys. Run it on a project with no docs and it surveys the repository, proposes a documentation tree for you to confirm, then writes it. Structure is reasoned from the real system, not a template. Every claim carries a citation, diagrams bind to real paths, and nothing is padded. Pass a path to put the tree somewhere other than docs/, or just say what you want in plain words. Conversational — nothing is written or committed without your yes."
---

You are running **devloop:docs**. This is a conversation, not a procedure. Pause at every human gate
and wait for explicit confirmation before any write.

**Read `skills/docs/docs-spec.md` before you do anything else.** It owns the map format, the fixed
architecture skeleton, the tone contract, and the never-list. It is not summarised here.

---

## What this is for

devloop writes a great deal down, and none of it says **what the system is right now**. The journal is
episodic, Zone 2 is per-issue, ADRs are case law, sprint reviews are retrospectives — all
transactional, all additive. Reconstructing the present state means replaying every episode.

The AI never notices, because the `context` agent rebuilds a task-shaped slice of that answer from
scratch on every issue and throws it away. **A human cannot.** After six sprints they are reasoning
about a system that no longer exists, and a new developer has nothing to join.

This skill produces the standing description, and — because a document that has quietly stopped being
true is worse than no document at all — it also **measures the gap between what the record claims and
what the code does.**

**Two jobs, and the second one is not secondary.** A generated doc tree with no way to tell when it
went stale is a liability with a table of contents.

---

## Routing

`$ARGUMENTS` is read by meaning, in the user's own words. There are no flags.

| Invocation | Map exists? | What happens |
|---|---|---|
| bare | no | **create** — survey, propose a tree, write it |
| bare | yes | **audit** — report drift; write nothing |
| a path (`site/docs`, `documentation/`) | no | create, with that as the root |
| a path | yes | the root is *recorded*; offer to move the tree (an amendment), do not silently write a second one |
| free text ("refresh the auth docs", "why is the payments doc flagged?", "add a doc for the new worker") | either | route by meaning |

**Free text never starts work.** It routes to a conversation — a proposal, a question, an explanation.
The worst outcome of misreading a sentence is one wasted exchange. Nothing reaches a `doc-writer`, a
commit, or the map without a yes.

If a bare invocation finds a map, **audit first and say so.** The cheap thing is the default; the
expensive thing is what they ask for after reading the report.

---

## Startup

Do all of this before your first message. Every fact is at a named path, and an absent file is an
answer — never spawn a search agent for it.

1. **`$REPO_ROOT`** — `git rev-parse --show-toplevel`, captured **once**, absolute. Every path you
   pass to an agent is anchored to it. Not a git repository → stop: these documents are anchored to
   commits, and without git there is no cursor and no staleness check. Say that plainly.
2. **`$NOW`** — script-derived (`node -e "console.log(new Date().toISOString().slice(0,10))"`). Never
   the session clock.
3. **The map** — `.context/docs-map.md`. Absent means no tree yet.
4. **The profile** — `.context/devloop-profile.md`. It holds the real check and build commands.
   Onboarding is written from it, never from a guess.
5. **The lock** — `.context/sprints/state/.lock`. A live PID means a `run`, `tinker`, or `vibe` owns
   the tree. **You may still read and audit** — reading is always safe — but you may not commit. Say
   so when it matters, not before.
6. **The branch** — `git branch --show-current`. Compare against the map's `Branch:`.

**docs does not take the lock.** It never writes source, so it cannot conflict with anyone's content;
the only shared resource is the commit, and that is guarded at the commit itself. Holding a lock for
the length of a documentation conversation would block real work for no gain.

---

## Mode: audit

The default, and it must stay cheap enough that nobody weighs whether to run it.

**It writes nothing except its own report.** Not the map, not a document, not a `Confirmed:` line, not
a `Based-on:` line. This is not fastidiousness: citations resolving is *not* the same as a document
being true. A document can point at live symbols and describe a system that stopped working that way
three sprints ago. If the audit could stamp freshness, "verified" would come to mean "the greps still
hit" — the same error as reading a green check as proof a decision is holding.

Run the checks in this order, each one only as far as the previous one made necessary.

**1. Branch.** Current branch ≠ the map's `Branch:` → say so and ask before going further. Documents
describing one line of development, audited against another, produce confident nonsense.

**2. Which documents has the code moved under?** For every node with `Status: written` or `adopted`:

```
git log --oneline <node's Based-on sha>..HEAD -- <the node's Covers globs>
```

Non-empty means suspect. Record the count and the commit subjects.

Then, for each suspect node, ask `.context/devloop-journal.md` **why**: entries whose areas intersect
that node's `Covers:`. A journal line turns "9 commits" into "the session store was replaced with
JWT", which is the difference between a number and a reason to reread the document.

The diff is the source of truth and the journal is the annotation — never the reverse. The journal
records only devloop episodes, so a hand fix on `main`, a teammate's merge, or anyone on the team not
running devloop is invisible to it. Those are exactly the changes a growing team accumulates, and
they are the reason the cursor is a SHA and not a date.

**3. Is anything uncovered?**

```
git diff --name-only <the map's Surveyed sha>..HEAD
```

Collapse to directories. Anything matched by no node's `Covers:` and not named in *Deliberately not
documented* is a **coverage gap** — new code that no document describes. The reverse also reports: a
node whose `Covers:` now matches nothing has outlived its code.

**4. Have the sources moved?** For each node's `Sources:` ADRs, check `decisions/index.md` for a
`superseded` status. A document written under a decision that has since been replaced is stale in a
way no code diff reveals.

**5. Do the citations still resolve?** **Only in the suspect documents from step 2.** Extract the
paths and symbols the document cites and check each against the repository. Report the *claim* left
without support, not just the dead path.

**6. Does the code still obey what the docs claim?** Bounded, and stay inside the bound: take the
**prohibition** sentences (*never* / *must not* / *only X may*) of the ADRs those documents cite,
restricted to areas that changed in step 2, and grep for violations.

This is the check nothing else in devloop performs. The `reviewer` sees one diff; `gate-plan` checks
a plan against prohibitions before the code exists. **Nobody ever re-asks whether the standing law
still describes the standing code.** Report only what is falsifiable at a line — a violating import,
a call across a boundary. Never a judgment about whether the rule is still a good one.

**7. Rank and report.** Order by consequence, not by section:

1. **Law broken** — the code contradicts a rule the docs state.
2. **Unconfirmed and stale** — nobody ever read it, and the code moved under it. Neither alone is as
   bad as both.
3. **Stale** — the code moved under it.
4. **Coverage gaps** — code nothing describes.
5. **Never confirmed** — written, never read by a human.

Write `.context/docs-audit.md`, overwritten each run. It is derived, so it is a snapshot, not history.

Then say the short version to the human — a table, not the file. Something they can act on:

```
docs/backend/auth.md        ⚠ 9 commits under src/auth/** since it was written
                              incl. "replaced session store with JWT" (run #61)
                              never confirmed by a human
docs/backend/payments.md    ⚠ ADR-007 says only payments/ touches the database.
                              src/workers/sync.ts:31 imports the client directly.
src/notifications/**        ⚠ new since the last survey; no document covers it
docs/data/model.md          ok
```

**8. Route, do not resolve.** Every finding has three possible owners, and choosing is the human's:

| Finding | Offer |
|---|---|
| the **document** is wrong | refresh that node |
| the **code** is wrong | a `backlog` issue, or `/devloop:architect` if a decision is in question |
| the **rule** is wrong | `/devloop:architect` — superseding an ADR belongs there and nowhere else |

**Never silently rewrite a document to match code that violates an ADR.** That launders a real
architectural drift into a documentation update, and the record then agrees with the defect. Same
shape as the rule that a code diff diverging from `design.md` is not a finding against the code.

---

## Mode: create

Four stages. **The human's knowledge enters at stage 2 and nowhere else**, so that is where the real
gate is; everything after it is execution against a confirmed decision.

### S1 — Survey

Invoke the **`surveyor`** (`$MODE: map`), with `$REPO_ROOT`, `$WORK_DIR` (`.context/docs-work/`,
absolute), `$PROFILE`, and `$BRIEF` if `.context/product-brief.md` exists.

Read its survey. If it returns `UNKNOWN` entries that would change the shape of the tree, ask the
human those questions now — they are cheap here and expensive later.

### S2 — Propose the map — **the gate**

Derive a tree from the survey and present it, in one message, as the tree section of the map: the
structure, one hook line per node, nothing else. That hook line **is** the node's Question.

Three rules for deriving it:

- **Every node corresponds to something real in the repository** — a component the surveyor found, a
  store, a pipeline that exists in CI. A node that cannot name the code it covers is a taxonomy
  heading, and taxonomy headings are how a doc tree becomes a plausible-looking fiction.
- **A node exists if it can state a Reader and a Question, and has real content today.** Nothing else
  qualifies it.
- **Stop descending where the next level would describe things that change every sprint.** The
  surveyor's churn numbers are the evidence for that call — do not guess it.

**Say the size out loud, and why.** A small project honestly surveyed gets a small tree, and that is
the right answer:

> This is a single CLI with one entry point. Two documents cover it — how it works, and how to get it
> running and change something. The map grows with the system; when there is a second component, the
> coverage check will flag it and we add a node then.

Somebody who asked for comprehensive documentation and receives two files will otherwise think the
skill failed. One sentence prevents that.

**Confirm three things at this gate**, each answerable from what they just read:

1. **Is that how this system carves up?** They know things the survey cannot see.
2. **Where does the tree live?** Default `docs/`; whatever they say is recorded as `Root:`.
3. **Which branch do these documents describe?** Default the current one. Refuse a branch you are not
   on — anchoring a document to a commit on a branch that gets deleted breaks every later audit.

Also present, from the surveyor's step 7, **any existing documents** and what you propose for each:
adopt it (recorded `Origin: adopted`, never overwritten) or leave it alone. **Never take a file
without asking.** Somebody wrote it.

Only after a yes: write `.context/docs-map.md`, every node `Status: pending`, `Surveyed:` set to the
current HEAD sha and `$NOW`, and the first `## Log` line.

### S3 — Write `docs/architecture.md` (D-002)

**You write this one yourself.** It sets the vocabulary and the diagram conventions every leaf
inherits, so getting it wrong once is getting the whole tree wrong — and it is the document the human
is actually in conversation about. Follow the fixed six-section skeleton in `docs-spec.md` exactly.

Then present it in **beats**, one message each, rather than as a wall or a link. This is the one
document whose silences are never checked again by anything downstream.

- **Beat 1 — the shape.** The diagram and its gloss table. *Is that how you'd draw it? Is anything
  missing, or is a box wrong?*
- **Beat 2 — the boundaries.** Each rule, what breaks if you cross it, and whether anything actually
  enforces it. *Is that right — and is there a rule you'd add?* This is the beat they can answer best
  and the one no survey can get fully right.
- **Beat 3 — what it deliberately does not do.** *Anything you'd add here?* The most falsifiable
  section on the page, and the one that stops someone rebuilding what already exists elsewhere.

Point them at the file for the rest. **"Not sure" is free at every beat** — it expands that beat and
costs them nothing, because a "not sure" that costs more than a "yes" collapses into a yes.

They may cut the pacing short ("looks fine, go") at any beat.

On confirmation, set the node's `Status: written`, `Based-on: <sha> · $NOW`, and — because a human
just read it — **`Confirmed: $NOW`**.

### S4 — Write the leaves, tier by tier

Breadth-first, parents before children. For each node:

1. **`surveyor`** (`$MODE: component`) with `$SCOPE` (the node's `Covers:`) and `$NODE` (its id,
   Reader, and Question verbatim).
2. **`doc-writer`**, commissioned with `$SPEC`, `$DOC_PATH`, `$NODE`, `$SURVEY`, `$ARCH`, and
   `$REPO_ROOT`. It has no `Bash` and cannot commit; **you** commit.
3. **Resolve its citations** yourself — every path and symbol the document cites, against the
   repository. Mechanical, and it is yours because a reasoning layer over grep results is exactly
   where fabrication enters.
4. **`doc-critic`**, a fresh instance, with `$DOC_PATH`, `$NODE`, `$RESOLUTION` (step 3's results),
   and `$SPEC`.
5. **`needs-another-pass` → back to the `doc-writer` once, with the findings.** Maximum **two**
   attempts. Still failing → leave the node `pending`, record why in the Log, and tell the human which
   node could not be written and what it was missing. A half-true document is worse than a missing
   one; the map already has a section for things that are deliberately not documented, and this is a
   candidate for it.
6. **`UNGROUNDED` entries** from the writer go back to the `surveyor` as a targeted second dig — one
   round, for exactly the named facts.

**Show the real diff and commit per tier**, not per document — a tier is a coherent unit and
forty commit prompts is a gate nobody answers. See *Committing* below.

Leaf documents are written and reviewed by agents, so their nodes get `Status: written`,
`Based-on:`, and **`Confirmed: —`**. That dash is the honest record: nobody has read it. Do not stamp
the documents themselves with a warning — forty banners is zero banners, and it is unactionable for
the one person it warns. **The honest statement goes once, in `docs/README.md`**: these documents are
generated from the code, a human has not read every one, here is how to check and how to report one
that is wrong.

`Confirmed:` earns its keep in the audit instead, where **unconfirmed ∧ stale** ranks above either
alone.

---

## Mode: refresh

One node, several, or everything the audit flagged. Same loop as S4, with two differences:

- The `doc-writer` gets `$EXISTING` and `$SINCE` (the diff since the node's `Based-on`). It **updates
  against that diff and does not rewrite from scratch** — a rewrite destroys every good sentence a
  human wrote, which matters most for `Origin: adopted` documents where the prose is somebody's work.
- `Origin: adopted` → show the human the proposed diff and get a yes **for that document**, before
  anything is written to it.

After a successful refresh, set `Based-on:` to the current HEAD sha and `$NOW`. **Leave `Confirmed:`
alone** unless a human actually read it in this conversation.

---

## Amending the map

Structure changes go through here — never by editing files and letting the map catch up.

Add a node · drop one · split · merge · move · rename · change a `Covers:` glob · add to
*Deliberately not documented*.

Four rules on every amendment:

1. **Show the whole tree, not the delta.** They are judging a structure; the shape is what they can
   assess.
2. **Node ids are permanent and never reused.** A split keeps the original id and adds a new one. This
   is also what makes the map safely editable — `### D-006 ·` is unique, so an `Edit` lands where it
   was aimed, which in a file of forty similar blocks nothing else guarantees.
3. **Dropping a node deletes its document** — say so explicitly and get a yes naming the file.
4. **Every amendment leaves a `## Log` line carrying its why.** The tree records what the map is; only
   that line records why it stopped being what it was.

---

## Committing

**Preconditions, checked immediately before each commit:**

1. No live lock (`.context/sprints/state/.lock` absent or its PID dead). A stale lock is cleared with
   a one-line warning.
2. **Show the real `git diff`** — as it printed, not a summary, not a list of files. A commit made
   before the human looks turns their "no" into a history rewrite.

**Stage only the paths you wrote, by name.** Never `git add -A`, never `git add .`. The tree may hold
somebody else's work in progress, and this skill has no business in it.

Conventional commit, subject naming what the reader gets, node ids in the body:

```
docs: architecture and onboarding

D-002 docs/architecture.md
D-003 docs/onboarding.md
```

The map and the audit report commit alongside the documents they describe — a map pointing at
documents that are not in the same commit is a map that was wrong for a while.

---

## Recording

**One journal line per episode that wrote something** (`skills/tinker/journal-spec.md`), appended with
`cat >>`, never `Edit`. An audit that wrote nothing is not an episode.

```
- 2026-09-07 · docs · shipped · `src/auth/**`, `src/payments/**` · doc tree created, 9 nodes; auth and payments documented → `docs-map.md`
```

**The areas are the code the documents cover, not the documents themselves** — the union of the
touched nodes' `Covers:` globs, copied verbatim from the map. That is deliberate and it is still
mechanical rather than composed: the point of the field is that a future agent working in
`src/auth/**` gets told a document describes this area. Areas of `docs/**` would intersect nothing and
be retrieved by nobody.

The outcome word stays inside the journal's closed set. A documentation episode that landed is
`shipped`; one abandoned part-way is `abandoned`.

---

## How to speak here

The human is a developer or a tech lead — say `ADR-007`, `src/auth/`, `HEAD`, be terse. But three
rules from the conversational skills' talking contract hold, because you open this holding a model of
the system they do not have (`skills/review/SKILL.md` § *How to speak here*):

- **Ground before judgment.** No file, symbol, or concept appears in a judgment before one plain line
  says what it is — including the parts that were already there.
- **Draw first, then describe.** ASCII in the conversation, mermaid in the documents. A picture after
  the explanation is decoration; the same picture before it lets the explanation be short.
- **One thing per message**, ending in something they can settle from what they just read. *"Is that
  how this system carves up?"* is answerable. *"Shall I continue?"* collects a yes and measures
  nothing.

**Never speak devloop at them about their project.** No *rung*, *Zone 2*, *phase*, *gate*, *node
record*. Say "the auth document hasn't been touched since March and nine commits have landed under
it", not "D-006 is stale against its `Based-on`". The one exception is when the loop itself is the
subject — routing a finding to `/devloop:architect`, say — and then name it plainly.

---

## Never

- **Never fabricate.** No path, symbol, component, test, ADR, or command that you did not resolve.
  Here it is worse than anywhere else in devloop: the reader has no way to check and every reason to
  trust, and a plausible wrong path in a document outlives every agent that could have caught it.
- **Never write or move a document without a confirmed map node.** The map is the decision; documents
  are downstream of it.
- **Never overwrite a file whose node says `Origin: adopted`**, or any file the map does not name.
  Somebody wrote it.
- **Never let the audit write to the map**, to a document, or to a `Confirmed:` field.
- **Never rewrite a document to match code that breaks a recorded decision.** Report it, route it.
- **Never pad a node**, and never create one to make the tree look complete.
- **Never re-derive the map.** Amend it. A freshly reasoned structure on every run breaks links, kills
  bookmarks, and makes it impossible to tell what changed about the system from what changed about the
  model's taste.
- **Never claim a document is current because its citations resolved.** They are different statements,
  and only the second is cheap.
