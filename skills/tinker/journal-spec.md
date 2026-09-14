# Journal spec — `.context/devloop-journal.md`

Shared spec. Read by every skill that finishes an **episode** of work — `run`, `tinker`, `vibe`, `review`,
`architect`, `abort`, `docs` — and by the `context` agent, its only real consumer.

---

## What it is

The `context` agent assembling Zone 1 is the **only** channel by which past work reaches a future run.
Without this file, a Zone 2 timeline, a retrospective or a hand-tuned value is written once and read by
nobody — and a value a human tuned while watching the app looks, to the next agent, like a careless number
to clean up.

Same shape as `.context/decisions/index.md`: **a small index scanned every time, pointing at big records
pulled rarely.**

**A fact channel, not a law channel.** An entry makes a future agent *aware*; ignoring one trips no gate.
Whatever should bind goes to `/devloop:architect` as an ADR, which is enforced.

---

## The format

One line per finished episode, appended in order:

```
- YYYY-MM-DD · <mode> · <outcome> · <areas> · <what and why> → <record>
```

```markdown
# devloop journal
<!-- Append-only. One line per episode of work, any mode. Newest at the bottom.
     Scanned by the context agent; entries are pulled when their areas match the work at hand. -->

- 2026-09-01 · run #43 · shipped · `src/auth/**` · JWT middleware + session store → `sprints/work/issue-43/`
- 2026-09-03 · run #46 · blocked · `src/api/cache/**` · warm-up; stuck at build after 3 tries → `sprints/work/issue-46/`
- 2026-09-05 · tinker · hand-tuned · `src/ui/toast/**` · toast 2s→4s (owner watched it, 2s too fast to read) → `tinker/2026-09-05-toast/context.md`
- 2026-09-05 · review s3 · closed · — · sprint 3 retro; 2 unproven rows still open → `sprints/sprint-3-review.md`
- 2026-09-06 · architect · decided · `src/api/**` · ADR-007 — database access confined to `api/` → `decisions/adr-007-db-in-api.md`
- 2026-09-07 · docs · shipped · `src/auth/**`, `src/payments/**` · doc tree created, 9 nodes → `docs-map.md`
```

| Field | What goes in it |
|---|---|
| **date** | `YYYY-MM-DD`, **script-derived** (`node -e "console.log(new Date().toISOString().slice(0,10))"`) |
| **mode** | `run #N` · `tinker` · `vibe m<N>` · `review s<N>` · `review patch #N` · `architect` · `abort #N` · `docs` |
| **outcome** | one word from the closed set below |
| **areas** | backtick-quoted globs, comma-separated, **derived mechanically**; `—` when no code changed |
| **what and why** | one line — the **why** is the load-bearing half |
| **record** | path relative to `.context/` to the detail that already exists; `—` if there is none |

**Outcome — a closed set:**

| Outcome | Means |
|---|---|
| `shipped` | merged and working as far as anything knows |
| `blocked` | started, stopped deliberately rather than fake a judgment; state left on disk |
| `abandoned` | torn down without shipping |
| `hand-tuned` | a human watched the running system and directed the change |
| `decided` | a decision was recorded (an ADR) |
| `superseded` | an earlier decision was replaced |
| `closed` | a sprint was sealed |

Never invent another word — one outside the set cannot be matched on, and *"somebody already tried this
and it did not work"* is the most expensive fact in a project to rediscover.

---

## Rules

- **Append with `cat >> .context/devloop-journal.md` — never `Edit`**, which lands wherever its anchor
  matched in a file of near-identical lines.
- **Never rewrite a line.** A wrong episode gets a new line saying so; edited history is not evidence.
- **Areas are derived, never composed.** `git diff --name-only <the episode's range>`, collapsed to
  directory globs. A plausible wrong path silently poisons every future retrieval.
  **Exception — `docs`:** the union of the touched nodes' `Covers:` globs, copied from
  `.context/docs-map.md`, since areas of `docs/**` would match nothing.
- **One line.** A paragraph belongs in the record.
- **Always the why** on anything that will look arbitrary later — `toast 2s→4s` is a changelog;
  `toast 2s→4s (owner watched it, 2s too fast to read)` is the reason this file exists.
- **Never fabricate a record path.** Point at a file that exists, or write `—`.

---

## What the `context` agent does with it

1. Scan the journal.
2. Select entries whose **areas intersect** the files this work will touch — the ~5 most recent.
3. Pull their records; extract only **standing facts** — values tuned and why, approaches abandoned and
   why, behaviour known unproven, decisions in force.
4. Emit them into Zone 1 under **`What happened here before`** — provenance, not history.

**Growth:** flat, one file. If it ever gets long, `review` may roll entries older than two sprints into
`.context/devloop-journal-archive.md` at sprint close, leaving a pointer line — never pre-emptively.
