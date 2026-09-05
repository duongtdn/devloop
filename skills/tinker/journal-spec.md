# Journal spec — `.context/devloop-journal.md`

Shared spec. Read by every skill that finishes an **episode** of work: `run`, `tinker`, `vibe`,
`review`, `architect`, `abort` — and by the `context` agent, which is the only consumer that matters.

---

## Why this file exists

There is exactly **one** channel by which past work reaches a future run's agents: the `context`
agent assembling Zone 1. Before this file, what it could retrieve was GitHub issues, the code itself,
and `.context/decisions/index.md`. Everything else devloop writes — an issue's Zone 2 timeline, a
sprint retrospective, a vibe manifest, a hand-tuned value — was written once and read by nobody
afterwards.

So sprint 4 rediscovered what sprint 2 learned, and a value a human tuned by hand while watching the
running app looked, to the next agent that opened the file, exactly like a number somebody typed
carelessly. The cheapest thing in the world is to "clean it up".

This file is the fix, and it is deliberately the **same shape** as `decisions/index.md`, which is the
one retrieval surface in this plugin that already works: **the index is small enough to scan every
time, and the records it points at are big and pulled rarely.**

**It is a fact channel, not a law channel.** An ADR prohibition is checked at `gate-plan` and
reversing it stops the line. A journal entry only makes a future agent *aware*; an agent that ignores
one trips no gate. That is the right default — most of what lands here does not deserve to be law.
Where something does, the escalation is `/devloop:architect` and an ADR, which **is** enforced.
Claiming more for this file than that would be the same failure as reading a green check as proof a
decision is holding.

---

## The format

One line per finished episode, appended in chronological order:

```
- YYYY-MM-DD · <mode> · <outcome> · <areas> · <what and why> → <record>
```

```markdown
# devloop journal
<!-- Append-only. One line per episode of work, any mode. Newest at the bottom.
     Scanned by the context agent; entries are pulled when their areas match the work at hand. -->

- 2026-09-01 · run #43 · shipped · `src/auth/**` · JWT middleware + session store → `sprints/work/issue-43/`
- 2026-09-03 · run #46 · blocked · `src/api/cache/**` · warm-up; stuck at build after 3 tries, run abandoned → `sprints/work/issue-46/`
- 2026-09-05 · tinker · hand-tuned · `src/ui/toast/**`, `src/lib/format.ts` · toast 2s→4s (owner watched it, 2s too fast to read); dates ISO→local → `tinker/2026-09-05-toast-and-dates/context.md`
- 2026-09-05 · review s3 · closed · — · sprint 3 retro; 2 unproven rows still open → `sprints/sprint-3-review.md`
- 2026-09-06 · architect · decided · `src/api/**` · ADR-007 — database access confined to `api/` → `decisions/adr-007-db-in-api.md`
```

### The five fields

| Field | What goes in it |
|---|---|
| **date** | `YYYY-MM-DD`, **script-derived** (`node -e "console.log(new Date().toISOString().slice(0,10))"`). Never the session clock. |
| **mode** | `run #N` · `tinker` · `vibe m<N>` · `review s<N>` · `review patch #N` · `architect` · `abort #N` |
| **outcome** | one word from the closed set below |
| **areas** | backtick-quoted globs, comma-separated — **derived mechanically** (see below). `—` when the episode changed no code. |
| **what and why** | one line. The **why** is the load-bearing half. |
| **record** | path relative to `.context/`, pointing at the detail that already exists. Never duplicate the detail here. |

### The outcome vocabulary — closed set

| Outcome | Means |
|---|---|
| `shipped` | merged and working as far as anything knows |
| `blocked` | started, stopped deliberately rather than fake a judgment; state left on disk |
| `abandoned` | torn down without shipping |
| `hand-tuned` | a human watched the running system and directed the change |
| `decided` | a decision was recorded (an ADR) |
| `superseded` | an earlier decision was replaced |
| `closed` | a sprint was sealed |

Do not invent a sixth. A word outside this set cannot be matched on, and the whole point of the field
is that *"somebody already tried this and it did not work"* costs one word to say and is otherwise the
most expensive thing in the project to rediscover.

---

## Rules that do not bend

- **Append with a shell append** (`cat >> .context/devloop-journal.md`) — **never `Edit`.** Same
  mechanism, same reason, as Zone 2: an `Edit` lands wherever its anchor matched, which in a file of
  200 similar-looking lines is routinely the wrong place. `>>` physically cannot.
- **Never rewrite an earlier line.** An episode that turns out to have been wrong gets a *new* line
  saying so. The file is history, and history that gets edited is not evidence.
- **Areas are derived mechanically, never composed.** Run `git diff --name-only <the episode's
  range>` and collapse the result to directory globs. Do not reason about "the area this affected" —
  a fluent, plausible, wrong path here poisons retrieval for every future run, and it fails the way a
  guessed MCP tool name fails rather than the way a missing file does: silently, with confident
  output.
- **One line.** If the episode needs a paragraph, the paragraph belongs in the record this line points
  at.
- **The `why` is not optional on anything that will look arbitrary later.** `toast 2s→4s` is a
  changelog and git already has it. `toast 2s→4s (owner watched it, 2s too fast to read)` is the only
  reason this file exists. Write the second one.
- **Never fabricate a record path.** Point at a file that exists. If the episode produced no durable
  record, write `—` rather than a plausible path.

---

## What the `context` agent does with it

Bounded, and the bound matters — Zone 1 is loaded by every downstream agent:

1. Scan the journal (one small file, like the ADR index).
2. Select entries whose **areas intersect** the files this work will touch.
3. Pull those records and extract only **standing facts** — values tuned by hand and why, approaches
   tried and abandoned and why, behaviour known to be unproven, decisions still in force.
4. Emit them into Zone 1 under **`What happened here before`**.
5. Cap it at the ~5 most recent matching entries.

This is **provenance, not history**. Zone 1 says *"the toast delay is 4s because a human watched 2s
and said it was too fast to read — 2026-09-05"*. It does not say what happened in sprint 2.

---

## Growth

Flat, one file, forever. A 200-issue project is 200 lines and scans as cheaply as the ADR index. If it
ever does get long, `review` may roll everything older than the last two sprints into
`.context/devloop-journal-archive.md` at sprint close, leaving a pointer line — but nothing should do
that pre-emptively, and the `context` agent reads only the live file.
