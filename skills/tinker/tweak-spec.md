# Tweak spec — the commissioned edit

Shared spec, read by `/devloop:review` (§4.5, the patch) and `/devloop:vibe` (§5, the patch). It owns
**one mechanism**: how a conversational skill gets **one small, no-behaviour change** into the code
without writing it itself. Each consumer adds its own preconditions and recording.

`/devloop:tinker` keeps the same four roles but owns its own gate, checks and escalation in
`skills/tinker/SKILL.md`; this spec does not govern it.

---

## The mechanism

> The skill commissions · the `coder` applies · the human reads the **real diff** · the skill commits on their yes.

- **The skill never edits source** — no `Edit` or `Write` on project code, not even one character. What
  judges the work is not what writes it.
- **The coder never commits** — `$NO_COMMIT` on **every** invocation. That is what makes the pre-commit
  scans and the human's eyes unskippable.
- **The human reads the real diff before it lands** — `git diff` as it printed, not a summary, not a list
  of files. A commit made before they look turns their "no" into a history rewrite.
- **The skill commits** — on an explicit yes, staging the shown paths **by name**.

---

## Preconditions

Checked before invoking anything:

1. **No live run holds the tree** — `.context/sprints/state/.lock` absent, or its PID dead.
2. **The working tree is clean** — `git status --porcelain` prints nothing; otherwise the commit sweeps
   up somebody else's work.
3. **The change adds no behaviour** — asked out loud and answered, never inferred from how small it looks.
4. Consumer-specific: `review` — the task shipped (`[x]`) in the **active** sprint; `vibe` — the task shipped.

---

## Invoking the coder

```
coder
  $MODE        express          (fix, when addressing a review finding)
  $NO_COMMIT   set              ← always
  $TASK        inline           — the change, and the exact files it may touch
  $WORK_DIR    absolute         — the consumer's work dir
  $LOG_DIR     absolute         — $WORK_DIR/logs/
  $CHECKS      from .context/devloop-profile.md
  $ACCEPTED    from .context/devloop-baseline.md
```

Paths are absolute, anchored to `$REPO_ROOT`: a check command may `cd` into a subpackage and a relative
log path would land there. A file in the diff that `$TASK` did not name is an escalation, not a surprise.

---

## The cycle

1. **Gate it** — say what will change, in the human's words; wait for an explicit yes. A question or a
   "hmm, maybe" is not consent.
2. **Invoke the coder** with `$NO_COMMIT`.
3. **Run the consumer's pre-commit scans** (`vibe`: secret scan and seed-boundary grep, every commit).
4. **Show the real diff** — `git diff` as printed — and which checks passed.
5. **Confirm:** *Commit this to `[branch]`? (commit / retry: [what to change] / discard)*
6. **Commit it yourself**, only on an explicit yes: `git add -- <paths>`, never `git add -A`.
   Conventional subject; the body says where the change came from.
7. **Record it** — per the consumer.

**retry** — the coder again with the correction. **Two coder attempts in total.**

**discard** — `git checkout -- <the tracked files the coder listed>`, delete the ones it created. Nothing
was committed. **Never `git reset`, never a broad `git clean`.**

---

## Escalate instead — do not push through

Stop the moment any of these appears, say plainly what happened, and convert it to tracked work:

- the coder returns `RESULT: blocked` or `NOTE: not-trivial`
- the checks still fail after the **second** attempt
- the coder touched, or needs, a file **nobody named**
- a design or architecture question appears

| Consumer | Escalates to |
|---|---|
| `review` | a rework issue via `/devloop:replan` — or `/devloop:tinker` when it changes behaviour or there are several |
| `vibe` | a follow-up task in the plan |

**Never commit a half-working edit, and never widen the file list to make one work.**

---

## Never

- Never edit project source from the calling skill.
- Never let the coder commit.
- Never commit before the human has seen the real `git diff`, or without an explicit yes.
- Never `git add -A`, `git reset`, or a broad `git clean`.
- Never exceed two coder attempts.
- Never fabricate a diff or a check result.
