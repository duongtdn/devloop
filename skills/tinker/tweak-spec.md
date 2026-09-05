# Tweak spec — the commissioned edit

Shared spec. Read by `/devloop:tinker` (every instruction), `/devloop:review` (§4.5, the patch), and
`/devloop:vibe` (§5, the patch). It owns **one mechanism**: how a conversational skill gets a change
into the code without writing it itself.

Each consumer adds its own preconditions and its own recording. Nothing here overrides those.

---

## The mechanism

> The skill commissions · the `coder` applies · the human reads the **real diff** · the skill commits.

Four roles, and the split is the whole safety story:

- **The skill never edits source.** No `Edit`, no `Write` on the project's code — not for a typo, not
  for one character, not while the file happens to be open. The thing that judges the work is not the
  thing that writes it.
- **The coder never commits.** `$NO_COMMIT` is set on **every** invocation. This is not an
  optimisation: it is what makes the pre-commit checks (secret scan, seed-boundary grep, the human's
  own eyes) structurally unskippable rather than merely mandated. Nothing can reach a commit without
  passing back through the skill.
- **The human sees the diff before it lands.** `git diff` as it printed — not a description of it, not
  a summary, not a list of the files touched. "Diff after" is what makes the gate real: a commit made
  before the human looks turns their "no" into a history rewrite.
- **The skill commits.** One tweak, one commit.

---

## Preconditions

Checked by the consumer before invoking anything. All are cheap.

**Universal:**

1. **No live run holds the tree** — `.context/sprints/state/.lock` is absent, or its PID is dead.
   One tree, one writer.
2. **The working tree is clean** (`git status --porcelain` prints nothing) — otherwise the commit
   sweeps up somebody else's changes.

**Added by the consumer:**

| Consumer | Adds |
|---|---|
| `review` §4.5 | the change adds **no behaviour**; the task shipped (`[x]`); it belongs to the **active** sprint |
| `vibe` §5 | the change adds **no behaviour**; the task shipped |
| `tinker` | none — behaviour changes are in scope here, and they bring a test with them first (see the skill) |

`review` and `vibe` both **ask the no-behaviour question out loud and get an answer.** Never settle it
silently from how small the diff looks.

---

## Invoking the coder

```
coder
  $MODE        express          (or fix, when addressing a review finding)
  $NO_COMMIT   set              ← always, no exceptions
  $TASK        stated inline    — the change, and the exact files it may touch
  $WORK_DIR    absolute         — the consumer's work dir
  $LOG_DIR     absolute         — $WORK_DIR/logs/
  $CHECKS      from .context/devloop-profile.md
  $ACCEPTED    from .context/devloop-baseline.md
```

`$WORK_DIR` and `$LOG_DIR` are **absolute**, anchored to a `$REPO_ROOT` captured once at startup. A
check command may `cd` into a subpackage and that `cd` persists for the rest of the agent's shell
session, so a relative log path resolved afterwards lands under the subpackage instead of `.context/`.

`$TASK` **names the exact files the coder may touch.** A file appearing in the diff that nobody named
is an escalation trigger, not a surprise to absorb.

There is no `plan.md` entry for a commissioned edit — the instruction *is* the task.

---

## The cycle

1. **Gate it** — say what will change, in the human's words, and wait for an explicit yes. A question,
   a "hmm, maybe", more discussion — none of those is consent.
2. **Invoke the coder** with `$NO_COMMIT`. It applies the change and runs `$CHECKS`.
3. **Run the pre-commit scans** the consumer owns (`vibe` and `tinker` in a vibe project: the secret
   scan and the seed-boundary grep — both on **every** commit, no exceptions).
4. **Show the real diff** — `git diff` as it printed — plus which checks passed.
5. **Confirm:**

   > Commit this to `[branch]`? (commit / retry: [what to change] / discard)

6. **Commit it yourself.** Conventional subject; the body says where the change came from.
7. **Record it** — per the consumer.

**retry** — re-invoke the coder with the correction. **Two coder attempts in total, no more.**

**discard** — restore the tracked files **the coder listed** (`git checkout -- <files>`) and delete the
ones it marked as new. Nothing was committed, so there is nothing to revert. **Never `git clean`
broadly and never `git reset`** — touch only the files the coder named. Anything wider is the edit
reaching outside its own scope, on a branch other people's work sits on.

---

## Escalate instead — do not push through

Stop and convert this into tracked work the moment any of these appears:

- the coder returns `RESULT: blocked`, or `NOTE: not-trivial` — the change was not what it looked like
- the checks still fail after the **second** attempt
- the coder touched, or says it needs to touch, a file **outside the ones named at the gate**
- a design or architecture question appears — that belongs to `/devloop:architect` or a planned issue,
  never to a gate inside a conversation

Say plainly what happened, then offer the alternative. Where each consumer sends it:

| Consumer | Escalates to |
|---|---|
| `review` | a rework issue via `/devloop:replan` |
| `vibe` | a follow-up task in the plan |
| `tinker` | `/devloop:backlog` (new scope) or `/devloop:replan` (rework of shipped work) |

**Never commit a half-working edit, and never widen the file list to make one work.**

---

## The never list

- Never edit the project's source from the calling skill.
- Never let the coder commit — `$NO_COMMIT` on every invocation.
- Never commit before the human has seen the real `git diff`.
- Never infer consent. The commit fires on an explicit yes to the commit question, nothing else.
- Never exceed two coder attempts.
- Never `git reset`, and never a broad `git clean` — discard touches only the files the coder named.
- Never fabricate: not a diff you could not read, not a check result you did not observe.
