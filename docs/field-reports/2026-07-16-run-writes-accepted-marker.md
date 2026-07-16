# Field report — `run` wrote a `✓accepted` annotation it doesn't own, by imitating neighboring lines

**Date:** 2026-07-16
**Reporter:** user, mid-sprint
**Severity:** medium — collapses the inner/outer-loop separation the whole `human-on-the-loop` design depends on
**Fix cost:** one clause added at the write site in `skills/run/SKILL.md`

---

## Summary

`run`'s issue-complete cleanup ticks the issue's checkbox in the sprint file. On this run, it also appended `✓accepted YYYY-MM-DD` to the line — a marker that belongs to `review` alone, per `plan-spec.md`, `review/SKILL.md`, and `CLAUDE.md`, all of which say so explicitly and in multiple places.

The instruction not to do this was never ambiguous. It was just **not where the mistake happened**.

---

## Root cause, in the agent's own words

> "Nothing there calls for a '✓accepted [date]' annotation. I added that text because it was already the
> pattern present in the sprint file for #25, #26, #27 — I copied the visual format without checking
> whether it was actually mine to write."

The ownership rule (`only review writes ✓accepted; only run ticks the checkbox`) lives in `plan-spec.md`, `review/SKILL.md`, and `CLAUDE.md` — all read earlier, none open at the moment of the edit. The sprint file itself, open at the moment of the edit, already had `✓accepted 07-08` sitting on adjacent lines from a prior `review`. Faced with a visible pattern at the edit site and a rule read several steps earlier, the model imitated the pattern.

This is the same class of gap as the milestone-null incident (`docs/field-reports/2026-07-13-cannot-clear-milestone.md`): a correct instruction that isn't reachable from where the action actually happens. There it was "the tool doesn't exist where the skill says to look"; here it's "the constraint doesn't exist where the edit actually happens."

---

## Why this matters beyond one wrong line

`✓accepted` is the entire mechanism that lets autonomous execution (`run --auto`, `sprint`) merge and close issues *before* anyone reviews them, and still leave a durable signal that no human has. If `run` writes it too, an auto-merged issue looks human-accepted the moment it ships — `review`'s "shipped-but-pending" state (`review/SKILL.md:233`) silently stops existing for that issue, and nothing else notices, because the sprint file looks exactly like the accepted-by-a-human case.

---

## Fix applied

`skills/run/SKILL.md`, issue-complete cleanup, step 2 — added a negative instruction at the write site itself rather than relying on the spec doc read earlier in the run:

> Tick the issue's checkbox `[x]` in `$SPRINT_FILE`. Touch only the checkbox. Neighboring lines may already carry a trailing `✓accepted YYYY-MM-DD` from a prior `review` — do not copy that annotation onto this line or any other; it is `review`'s marker alone, and `run` writing it here would make an unreviewed, auto-merged issue look human-accepted.

---

## Note for whoever picks this up

The lesson generalizes: a negative constraint stated only in a shared spec doc is not reliable protection against imitation once the model is looking at a file that already contains the pattern it's told not to produce.

**Follow-up (same day):** checked `plan` and `replan`, the other two skills that write the sprint file. `plan` always writes a brand-new file, so there's nothing on disk yet to imitate — low risk. `replan` was exposed the same way `run` was: its `add`, `rework`, and `split` operations all insert new issue lines into a sprint file where sibling lines may already carry `✓accepted`, with no instruction against copying it. Added the same guard clause at each of the three write sites (`skills/replan/SKILL.md`, operations add/rework/split). `replan`'s `reorder` operation was already correctly guarded ("preserving every line's content verbatim") since it only ever moves existing lines, never authors new annotation text.

---

## Provenance

- `skills/run/SKILL.md` — issue-complete cleanup, step 2 (the edit site)
- `skills/plan/plan-spec.md:98` — `✓accepted` ownership rule
- `skills/review/SKILL.md:133,342` — where the marker is actually written
- `CLAUDE.md:117` — "only `review` writes it; only `run` ticks the checkbox"
- Related: `docs/field-reports/2026-07-13-cannot-clear-milestone.md` — same shape of gap (instruction correct, unreachable from the action site)
