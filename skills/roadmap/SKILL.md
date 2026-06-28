---
description: Init or update the project master plan from the current conversation. Reviews what was discussed about the project vision and sprint themes, proposes master-plan.md content, lets the user confirm or edit, then writes the file. Conversational — pauses at every step for user confirmation.
---

You are running **devloop:roadmap**. This skill is fully conversational — pause at every human gate and wait for explicit confirmation before moving to the next step.

User may have passed a focus hint via `$ARGUMENTS` (text typed after `/devloop:roadmap`). If present, treat it as a filter: only surface roadmap content relevant to that topic or area.

---

## Master plan format

`context/sprints/master-plan.md` is the project's single source of truth for vision and sprint sequencing. Its canonical layout is:

```markdown
# [Project Name] — Master Plan

## Vision
[1–3 sentences: what this product does, who it's for, and what problem it solves]

## Sprint Map

### Sprint 1 — [Theme]
- **Goal:** [one sentence: what a user could demo at the end]
- **Status:** planned | active | completed
- **Sprint file:** `context/sprints/sprint-1.md`  ← written by /devloop:plan when the sprint starts

### Sprint 2 — [Theme]
- **Goal:** ...
- **Status:** planned
```

**Ownership rules:**
- `roadmap` writes and updates: Vision, sprint themes, `Goal:` lines, `Status: planned`, new sprint entries
- `plan` writes: `Status: active`, `Sprint file:` lines; may update `Goal:` to the confirmed sprint goal
- `review` writes: `Status: completed`
- The Sprint Map is append-only for ordering — never remove or renumber existing sprints. Future sprints may be reordered if not yet started.

**Status lifecycle:** `planned` → (plan runs) → `active` → (review runs) → `completed`

---

## Step 0 — Read existing master plan

Read `context/sprints/master-plan.md` if it exists.

**If it exists**, extract:
- Current Vision text
- All sprint entries: number, theme, Goal, Status, Sprint file (if present)
- Note which sprints are `active` or `completed` — these are locked (roadmap must not change their theme, status, or sprint file)

**If it does not exist**, note that this is a first-time init and proceed.

---

## Step 1 — Extract roadmap content from conversation

Review the entire conversation that preceded this skill invocation. Your goal is to surface the vision and sprint sequence the user has been discussing.

**Two things to extract:**

1. **Vision** — what the product does, who it is for, and what problem it solves. Distill to 1–3 sentences. If already in the master plan, check whether the conversation revised it.

2. **Sprint sequence** — the themes and rough goals for each sprint. A theme is a short label (e.g. "Foundation", "Auth", "Core Feature"). A goal is one sentence describing what a user could demo at the end.

If `$ARGUMENTS` is non-empty, apply it as a filter: only surface roadmap content relevant to the specified topic or area.

**Preservation rules:**
- Sprints with `Status: active` or `Status: completed` — preserve theme, Goal, Status, and Sprint file exactly. Do not propose changes to them.
- Sprints with `Status: planned` — may be updated with new theme or refined goal from the conversation.
- New sprints — append after existing entries.

If the conversation contains no roadmap-relevant content (no vision, no sprint themes):

> No roadmap content found in this conversation — nothing to update.

Stop.

If a Vision was found but no sprint themes were discussed, note this before proceeding to Step 2:

> I can capture the vision, but no sprint themes came up in our conversation. You can add them in the next step, or we can proceed with vision only and add themes later.

Continue to Step 2.

---

## Step 2 — Present draft and confirm

**Human gate — present what will be written and wait for approval:**

If this is a first-time init:

> `context/sprints/master-plan.md` not found. Here's what I'll create based on our conversation:
>
> **Vision:** [1–3 sentences]
>
> **Sprint map:**      ← omit this section entirely if no sprint themes were extracted
> - Sprint 1 — [Theme]: [brief goal]
> - Sprint 2 — [Theme]: [brief goal]
> - ...
>
> Adjust anything or confirm:

If updating an existing file, show only what will change:

> **Proposed changes to `context/sprints/master-plan.md`:**
>
> **Vision** _(updating)_
> → [new vision text]     ← omit this block if Vision is unchanged
>
> **Sprint map changes:**
> - Sprint 2 — [Theme]: goal updated to "[new goal]"    ← for planned sprints with updated goal
> - Sprint 3 — [New Theme]: adding as `planned` with goal "[goal]"    ← for new sprints
>
> Locked (active/completed — not changing): Sprint 1    ← list any locked sprints
>
> Adjust anything or confirm:

Wait for the user's response. Accept bulk edits ("change sprint 3 theme to 'Payments'") or item-level changes. Apply changes and re-present the updated draft. Repeat until the user explicitly confirms.

---

## Step 3 — Write master plan

On confirmation, write `context/sprints/master-plan.md`. Create `context/sprints/` if it does not exist.

**If creating from scratch:** write the full file using the confirmed content.

**If updating:** apply only the confirmed changes. For each sprint entry with `Status: active` or `Status: completed`, copy the existing lines verbatim — including `Sprint file:` if present. Do not regenerate or reformat locked sections.

After writing:

> Master plan written to `context/sprints/master-plan.md`.

---

## Step 4 — Epic label sync (optional)

If no repo was established from context, skip this step silently.

If a repo is known, offer to sync epic labels:

> **Epic labels** — derive one label per sprint theme: lowercase, spaces to hyphens, `epic:` prefix (e.g. "Core Feature" → `epic:core-feature`).
>
> | Theme | Label |
> |-------|-------|
> | Foundation | `epic:foundation` |
> | Auth | `epic:auth` |
>
> Create any missing labels in `[owner/repo]`? (y/n — or list specific ones to skip):

Wait for response. On yes (or a subset), check which labels already exist via GitHub MCP and create only the missing ones. Skip existing labels silently. Report:

> Labels created: `epic:foundation`, `epic:auth`
> Already existed: `epic:core-feature` ← omit if none

On no, skip silently.

---

## Completion report

> **Roadmap updated** — `context/sprints/master-plan.md`
>
> **Vision:** [vision text]
>
> **Sprint map:** [N] sprints ([X] locked · [Y] updated · [Z] new)    ← omit any count that is zero
>
> Run `/devloop:plan` to start or continue a sprint.
