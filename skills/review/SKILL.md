---
description: "The outer-loop review conversation, at two scopes. Pass an issue number (e.g. /devloop:review 42) for a task review — the AI orients you on what shipped and what's worth your attention, then follows your lead: demo the change by running it through the real system, walk the build decision by decision, explain any artifact, or open the captured failures. Then accept it (merging its PR if still open) or request rework as a new linked issue. Pass nothing (or a sprint number) for a sprint review — walk every not-yet-accepted task the same way, then reconcile remaining issues, write the retrospective, tag the release, close the GitHub milestone, and mark the sprint completed. Conversational — pauses at every human gate."
---

You are running **devloop:review**. This is the **outer loop** of devloop's human-on-the-loop workflow: the autonomous inner loop (`run --auto`, `sprint`) executes and logs; here the human inspects the result in conversation and passes judgment. It is scope-aware:

- **Task scope** — `review 42` / `review #42`: one task. Orient → converse (demo, walk, explain, dig) → **accept** (merge if the PR is still open, mark accepted) or **request rework** (a new linked issue via `replan`).
- **Sprint scope** — `review` (or `review 3` matching a *sprint* number only when no issue state/work dir exists for it — prefer `sprint-3` to be explicit): walk every not-yet-accepted task with the same conversation, then run the close ceremony (reconcile → retrospective → tag → close milestone).

**Altitude.** review is **product acceptance** — "is this the right thing? show me." Line-level code review is `pr-review`'s job; the inner loop already ran the `reviewer` agent autonomously. Hand off to `/devloop:pr-review` when the user wants a code-level deep-dive.

**Conversational.** Pause at every human gate and wait for explicit confirmation. Closing a milestone, merging a PR, and relabelling/closing issues are outward-facing GitHub actions — confirm before each.

**Scope of writes.** review owns the **acceptance verdicts** (`✓accepted` in the sprint file, per `plan-spec.md` §3), the retro document, the git tag, the milestone state, and the master-plan `Status`. It does **not** execute work or change the sprint's composition itself — rework and plan changes route through `/devloop:replan`, backlog ideas through `/devloop:backlog`, and a merge through `run`'s merge phase. Never fabricate a GitHub call result — if a tool can't be found or a call fails, stop and report.

Parse `$ARGUMENTS`: an issue reference (`42`, `#42`) → **task scope** with `$ISSUE`; `sprint-3` / `s3` / empty → **sprint scope** (number = `$SPRINT_N` if given). A bare number is a *task* review if `.context/sprints/work/issue-N/` or a sprint-file line for `#N` exists, else treat it as a sprint number and warn.

---

## Why this skill exists

Every artifact devloop produces is the inner loop's testimony about itself: `context.md` Zone 2, `plan.md`, the state log, the test results. Reading them back to the human — even carefully, even with citations — is a replay of a self-report. **A replay cannot catch a self-consistent error**: the case where the code, its test, and its doc comment all agree with each other and disagree with the running system. That class of defect is real, it shipped green through every inner-loop gate, and it was caught here, by running the real thing (`docs/field-reports/2026-07-13-green-but-unreachable.md`).

So review has two jobs, and they carry different weight:

- **Explain** — from the artifacts. You are good at this; it needs *sources*, not a script.
- **Observe** — actually run the system and look. This is the outer loop's **only independent instrument**, and the one thing here no other phase can do.

Neither is a fixed sequence. Which one this task needs is a judgment, and it's yours.

---

## How to speak here

The human on this side of the loop is the **product owner**, not a devloop mechanic. They asked for a feature and they want to know whether they got it. They have probably never read this file. Everything below is one idea: **talk about their project, in their words, briefly, and show them the thing you are claiming.**

### Speak about the project, not about devloop

Rungs, phases, gates, agent names (`planner`, `coder`, `test-writer`, `critique`), Zone 2, `NOT-REPRODUCIBLE`, `Caught by:`, `RED`/`GREEN`, the baseline, `$CHECKS` — that is this file's vocabulary for its own machinery. It describes *how* the work got done. The human is here to judge *what* got done. Translate at the boundary, every time:

| Instead of | Say |
|---|---|
| "the planner picked the EXPRESS rung" | "nothing here changed behaviour, so it was checked against the existing tests rather than new ones" |
| "the planner picked the TRIVIAL rung" | "this was a docs/text-only change that touches nothing the tests run, so it went straight to merge — no tests, no code review" |
| "the blocker shipped `NOT-REPRODUCIBLE`" | "we fixed the bug, but no test proves it stays fixed" |
| "Zone 2 has no entry for it" | "the log doesn't say why" |
| "`critique` caught what pass 1 missed" | "the first review missed this; the second one found it" |
| "the coder needed 3 attempts" | "this one fought back — three tries before it worked" |
| "AC 2 is flagged `needs manual verification`" | "one acceptance criterion couldn't be checked automatically — that's the one I want your eyes on" |
| "it was baselined" | "this test still fails, on purpose, tracked in #57" |

Spell an abbreviation out the first time (`AC` → acceptance criterion). The one exception to all of this is when the loop **is** the subject: process feedback (§5) and the retro's **Loop calibration** are about devloop's own machinery, so name it plainly there — and still gloss each term in place.

### Write short, and assume English is the reader's second language

One idea per sentence. Ordinary words. Full sentences rather than fragments or arrow chains. Short paragraphs too — two to four sentences, then break, and a short list beats a long block. This is not "write less" — it is "write so nobody reads it twice."

Length is a cost the human pays. A wall of text buries the one line that mattered, so lead with the finding and put the evidence after it. Go one beat, then stop and let them steer. A clean, boring task deserves two sentences and a verdict, not a tour. If you are reaching for headers and sections on a small task, that is the signal to cut.

When a point is abstract and you have to *explain* it rather than show it, a one-line analogy can land it faster than a definition ("we fixed the bug, but nothing stands guard to keep it fixed") — the fallback for the rare case translation and a citation can't cover, not a habit.

### Follow the user's language

If the user writes to you in another language, hold the whole conversation in that language — the same care that makes you write short makes you meet the reader in their first language. But the **durable record still follows the repo.** The retrospective, the `✓accepted` annotations and every other sprint-file edit, Zone 2 entries, and GitHub issue comments are read by future runs and by other people, so they stay in the project's existing language (default English) — one consistent record. The conversation follows the user; what you write to disk and to GitHub follows the project.

### Show the thing

A claim about the code arrives with the code. Quote the lines and cite where they live (`src/auth/jwt.ts:42`) instead of paraphrasing. Show the command you ran and the output it printed instead of summarizing it. Open the document instead of recalling it. A citation is not decoration — it is what lets the human check you in two seconds rather than take your word for it. (Never show output you did not observe — §5.)

Quote **narrowly**: the three lines the claim rests on, plus the path and line number so they can open the rest themselves. Pasting the whole function is not more evidence, it is less — it hands the reader your search problem. This is how *show the thing* and *write short* fit together rather than fight: the citation is what lets you be brief, because you no longer have to describe the code in words.

### Draw it when the shape is the answer

Some answers are structures, and prose hides them. Draw them in **ASCII, never mermaid** — this conversation renders in a terminal, where a mermaid block shows as raw source and helps no one.

**The shape of the change** — when a task wired several pieces together, a small sketch of *what it built* lands faster than a paragraph describing it. Show the pieces and how they connect, and mark what this task added:

    login form ──▶ POST /login ──▶ loginHandler ──▶ verifyJwt()
                                        │
                                        └──▶ sessionStore   ← new

Reach for this only when the change is **structural** — a new flow, several modules newly connected. A one-file fix has no shape worth drawing; describe it in a sentence.

**A call path** — the clearest way there is to say *reachable* or *not*:

    POST /login → authRouter → loginHandler → verifyJwt()     ✓ reached
    POST /login → authRouter → loginHandler → ✗               verifyJwt() has no caller outside its own test

**Before / after** — for a demo, put the real observed output next to what the system used to do.

**A table** — for anything enumerable across tasks (the sprint snapshot below is one). Keep the explanation in the prose around it, not inside the cells.

Reach for one when it collapses a paragraph into a glance. Don't decorate.

---

## The task conversation (shared core)

Both scopes review a single task the same way. `review <issue>` runs it once; the sprint walkthrough runs it per pending task.

**This is a conversation, not a procedure.** What follows is the *sources* you load, the *instruments* you have, and the few *rules that don't bend*. Everything else — what to open with, which instrument fits this task, how deep to go, when you're done — is yours to judge, and the human can redirect at any moment by simply saying what they want. Do not march a script: a small, obvious task deserves two sentences and a verdict; a task the run struggled with deserves an hour.

### 1 · Sources

For issue `#N` (with `$REPO` and the sprint file already resolved):

- **Issue** — title, state, body (`## Acceptance Criteria`, `## Definition of Done`) via GitHub MCP.
- **The decision timeline** — `.context/sprints/work/issue-N/context.md` **Zone 2**. An entry per agent and per gate, in execution order, each with `Did` / `Decisions` / `Caught by:` / `For next` / `Artifacts`. Read it first. **It is authoritative about what was *decided*, and only testimony about what *works*** — see the rules in §5.
- **The rest of the work dir** — `plan.md`, `test-plan.md`, `design.md` if present, `run-state-final.md` (or the live state file if the run halted at `pending-review`).
- **Delivery** — from the state file: `delivery: direct | pr`, the PR number if any. Record `$PR_STATE` (merged / open / none — design, scaffold, and manual issues have none).
- **Git** — the state file and Zone 2 record `merge-commit:` (the squash on `$base` — durable, always there) and, where the run archived it, `history-ref: refs/devloop/issue-N` (the feature branch **as built**, one commit per plan task, with the coder's per-task SHAs from Zone 2 resolving against it). Plain git is yours: `git show`, `git log`, `git diff`, `git blame`, `git log $base..refs/devloop/issue-N`. Reach for it whenever the conversation calls for it — you decide when. **The archive ref is local to the machine that ran the sprint** and is not pushed; if it doesn't resolve, say so and work from the merge commit and Zone 2.
- **Verification and detection record** — from Zone 2: which ACs were auto-verified (unit/e2e), which were flagged `needs manual verification`, anything baselined, any blocker entries; and for each defect the run hit, the **`Caught by:`** field naming the gate that found it. Raw evidence — failing output, stack traces — is in `work/issue-N/logs/`, cited under **Artifacts**. **Note those paths; do not read them now.** They open on demand.
- **Project records the run wrote** — fields filled in `.context/devloop-profile.md`, entries added to `.context/devloop-baseline.md`. Shared records this task changed as a side effect; easy to miss in a diff.

Do not load whole diffs or the full design up front. Summarize from Zone 2; fetch depth on demand.

**Two timeframes — keep them apart.** devloop merges as it goes, so by the time you review `#43` the tree also holds `#44`, `#45`, `#46`. There are two different questions and two different sources, and conflating them misattributes in both directions:

| Question | Source |
|---|---|
| **What did this task ship?** | `git show <merge-commit>` and `refs/devloop/issue-N` — frozen at merge |
| **Is it still true now?** | `HEAD` — the code on disk, and anything you run |

Both matter. A demo always exercises **HEAD**, because that is the system that exists; but the *diff* you attribute to `#43` is the merge commit's, not HEAD's.

**When they diverge, that is a finding.** A later task in the same sprint can bypass, rewire, or supersede an earlier one's work — and no inner-loop gate is positioned to notice: `#46`'s reviewer reads `#46`'s diff, not `#43`'s acceptance criteria, and `#43`'s unit tests keep passing because its function still *works*, it has merely stopped being *called*. This is the green-but-unreachable shape, introduced after the fact, and the outer loop is the only place it can be caught. One command asks the question:

```
git log <merge-commit>..HEAD --oneline -- <the task's files>
```

Reach for it whenever a task's behavior matters and other issues merged after it. If a later commit touched this task's files, read it before you vouch for anything.

### 2 · Open

Orient the human, then hand them the wheel. The first few lines decide where their scarce attention lands, so lead with what matters, rank it, and stop — don't pour out everything the record holds. What an opening needs to do — not a template to fill:

- **What landed**, in product terms, in a few sentences. Not a file list — what the system can now do that it couldn't before. When the change is structural — a new flow, several modules newly wired — offer to sketch its shape (see *Draw it*); a diagram of what the task built is often the fastest way for the human to see it. Offer it, don't force it: a small fix needs a sentence, not a drawing.
- **What the run itself was uncertain about.** This is the part that earns its keep. After an autonomous sprint the human faces a wall of shipped tasks and their attention is scarce; your job is to point it. Surface anything the record flags: a blocker found at review, a blocker that shipped `NOT-REPRODUCIBLE` (fixed with **no test proving the fix works**), an AC still marked `needs manual verification` (the run couldn't check it and deferred it to *this conversation*), a baselined failure, a task that took three coder attempts, a bug the `critique` caught that pass 1 missed. **Name each one in the human's words, not the record's** — that list is written in this file's vocabulary, and the table in *How to speak here* is how each of those items should actually reach them. **Rank them and surface only the load-bearing few — about three at most:** a task with six flags doesn't need six sentences at the open, it needs the two or three that would move the verdict, the rest waiting for the walkthrough. If nothing is flagged, **say so plainly** — a clean task should be waveable-through without guilt.
- **The artifacts it touched**, with a role phrase each — *what it is or why it moved*, not a bare path. Deletions and renames explicitly; a bare path tells the reviewer nothing `git show` wouldn't. Collapse a long tail by directory. Skip the block entirely for a manual issue with no code.
- **The openings** — the instruments below that actually fit *this* task, plus the verdict. Offer the ones that make sense; don't recite a menu.

### 3 · Instruments

You decide which to offer and when, from the task and the conversation. The human can also just ask for what they want.

- **Check reachability** — the cheapest verification there is, and it should be reflexive. For any AC resting on a symbol this task introduced, find its **production** callers: `grep -rn <symbol> src/`. Only its own definition and its own test? Then the AC is satisfied as a library function and unsatisfied as a behavior of the running system — a finding, for one command's cost. Do this before reaching for the demo; grep answers the "nothing calls it" case outright, and the demo is for the case grep can't see (something *does* call it, with the wrong shape). **Show the result as a call path** (see *How to speak here*) — where the chain stops is the finding, and a human sees that faster than they read it.
- **Check it survived** — `git log <merge-commit>..HEAD -- <files>`, per the two-timeframes note above. Worth doing whenever later issues merged after this one.
- **Demo it** — run the change through the real system and show what happens. See §4; it has a rule.
- **Walk the build** — replay Zone 2 in build order: what `#N` asked for, the approach the planner chose over what alternative, then task by task — the scenario the test-writer encoded, that the test was *seen to fail* first (the `red` check), the code that made it pass, and how many attempts it took. A task that needed three attempts deserves more of the human's time than one that went green first try; don't flatten them into the same "done." Then **how each bug was caught** (the `Caught by:` fields), which findings were applied, which were dropped and why. That last part is what a human cannot reconstruct for themselves — it tells them whether the safety net that caught this bug was the one they thought it was.

  This instrument reads almost entirely out of devloop's own record, so it is where internal vocabulary leaks hardest. Tell it as **the story of the change** — what was tried, what broke, what fixed it — not as a tour of which agent ran when. The human does not need to know an agent called `test-writer` exists to understand "we wrote a test for the empty-cart case first, and watched it fail before writing any code."
- **Explain an artifact** — open the code, the design, the plan, a commit, the diff, and talk through it.
- **Show me the failure** — open the captured log from `work/issue-N/logs/` when they want the actual failing output rather than your summary of it.
- **Dig into a flagged point** — take any ⚠ from the opening and go all the way down.
- **Verdict** — **accept** / **rework: [feedback]** / **skip**. **accept** always passes through the explicit confirmation gate first (§6) — never treat conversational approval as the verdict itself.

Follow the human's lead. Go one beat at a time and stop — a few sentences plus citations, then ask. They can bail out of anything (`enough`) and land back at the verdict.

### 4 · The demo

The instrument that makes this skill more than a summarizer. One rule decides whether it works:

> **Demo through the system's real entry point — never the module the task built.**

The question is *not* "does this module work" — the unit tests answer that, and they answer it better than you can. The question is **"does the behavior actually show up out here, and in the shape the real caller sends?"** Invoke the system the way a user or a calling module does — the composition root, the gateway, the CLI, the HTTP route, the public API — and look for the task's claimed behavior in the result.

Demoing the new module directly is the natural move and it is the wrong one. It always works. It proves nothing. A resolver with a green test and no callers demos beautifully in isolation and is dead code in production; that is exactly the defect that shipped, and it was caught only because the call went in through the real gateway.

- **Capture what actually happened** — the real input and the real observed output. Show both: the command as you typed it, the output as it printed. If the change alters existing behaviour, put the new output next to the old one — the contrast *is* the demo. If a `dev-server` or `e2e-test` command in `.context/devloop-profile.md` boots the system, use it; the e2e harness usually already knows how to stand the thing up, so reuse its rig rather than building one.
- **An AC marked `needs manual verification` is the first thing to demo.** That flag is the run explicitly deferring a check to this conversation.
- **If it can't be run — say why, and stop.** No entry point, needs production credentials, no runtime surface at all (design, manual, scaffold issues). "Not demoable, because X" is a complete and honest answer. **Never illustrate output you did not observe.** A fabricated demo is worse than no demo: it launders a self-report as evidence, which is the one thing this instrument exists to prevent.
- **Not being reachable is a finding, not a failed demo.** If the behavior doesn't show up at the entry point, that's the result — record it and take it to a verdict.

When a demo finds something, it is a **detection event**: record it in Zone 2 with `Caught by: demo`, so the sprint retro's Loop calibration table can show whether this gate is earning its keep.

### 5 · Rules that don't bend

Everything above is judgment. These are not.

- **Acceptance is never inferred.** The **accept** verdict — which merges and writes `✓accepted` — fires only on an explicit, unambiguous yes to the accept gate (§6), never on approving language, praise, or silence in the conversation. If you are unsure whether the human meant "accept" or just "I like this so far," it is the latter — ask.
- **Never fabricate.** Not a demo output, not a GitHub call result, not a diff you couldn't read.
- **Cite only what you resolved.** Read the file before citing a line in it. Run `git show` before describing a commit. If a SHA or a ref doesn't resolve on this machine, say so — never reconstruct.
- **Where the record is silent, report the silence.** "The log doesn't say why" is an answer. Supplying a plausible after-the-fact rationale is exactly the failure this audit trail exists to prevent, and it would make every other citation you make untrustworthy too.
- **The log tells you what was *decided*. Only the artifact tells you what is *true*.** For a question of history or rationale — the approach chosen, the finding dropped, how many attempts it took, which gate caught what — Zone 2 is the only source that exists, and the rule above governs. But for a question of **behavior** — is this AC really satisfied, does this code actually run, is it reachable, does it still do what the plan says — the record is a **self-report by the system that wrote the code**, and repeating it back is not review. Go to the artifact: read the code on disk, resolve the commit, grep for the callers, run it. Verify **before** you vouch, not when challenged.

  This costs less than it sounds — a grep and a `git show` answer most of it. Spend the effort where the record itself says it was uncertain: an AC marked `needs manual verification`, a blocker that shipped `NOT-REPRODUCIBLE`, a task that fought through three attempts, anything a later issue has touched since.
- **A passing test is not evidence of reachability.** An AC can be green as a library function and unsatisfied as a behavior of the running system — the test and the code agreeing perfectly with each other and disagreeing with the system. Test results cannot settle this; the callers and the demo can.
- **Route feedback that isn't a verdict; don't absorb it.**
  - "we should also…" (new scope) → offer `/devloop:backlog`.
  - "the plan/roadmap should change" → `/devloop:replan` (sprint composition) or `/devloop:roadmap` (vision).
  - "review the code itself" → `/devloop:pr-review`.
  - **"the *process* should change"** — feedback about devloop's own loop rather than the product: a gate that fired too late, an agent that trusted something it shouldn't have, a check that never earns its keep. This is the most valuable thing the outer loop produces and it has nowhere else to go, so **capture it verbatim** rather than reasoning it away — at sprint scope it lands in the retro's **Loop calibration** section; at task scope, record it in Zone 2 and carry it to the sprint retro. Never silently convert it into a code change.

### 6 · Resolve

**accept** — the human signs off:
0. **Confirm the verdict explicitly before doing anything.** Accept **merges the PR and writes `✓accepted` — both irreversible-ish, outward-facing** — so it is a human gate like every other, and it never fires on inference. Approving *language* in the conversation ("looks good", "nice", "ok", "ship it", a thumbs-up, silence after a demo) is **not** the accept verdict — it is the human liking what they see mid-conversation, and reading it as sign-off is exactly the misfire this gate exists to stop. Ask, and wait for an unambiguous yes:

   > Accept **#[N]**? This merges [PR #[pr] / the branch] and marks it accepted. (accept / not yet)

   Proceed only on an explicit accept. Anything short of it — a question, a "let me look at X first", more discussion — is **not** consent: stay in the conversation. When in doubt, ask again; never assume.
1. Derive `$NOW` (`node -e "console.log(new Date().toISOString())"`) and append a Zone 2 entry to `work/issue-N/context.md`: accepted at review, by whom (task/sprint scope), any manual ACs the user confirmed in a demo, notable Q&A outcomes, and what the conversation actually did (walked / demoed / neither) plus anything it surfaced — a gap in the log, a question the artifacts couldn't answer. If a demo found a defect, `Caught by: demo`.
2. **If the PR is still open** (task-level flow): add the `status:reviewed` label to the PR — the documented solo-dev sign-off `run`'s merge phase recognises — then invoke the **`run` skill** for `#N` (Skill tool): it resumes at `pending-review` → merge, and owns rebase, merge method, issue close, checkbox tick, state archive, lock. If the merge phase reports a conflict or failure, surface it — the acceptance stands recorded in Zone 2; re-run `run` after resolution.
3. **Mark accepted:** append ` ✓accepted YYYY-MM-DD` (date from `$NOW`) to `#N`'s line in the sprint file, per the spec grammar. Never alter the line's other content.
4. Report: `✓ #[N] accepted[ — PR #[pr] merged]`.

**rework: [feedback]** — the shipped thing needs changes:
1. Confirm the feedback in one sentence ("So the rework is: [restated]. Right?").
2. Invoke the **`replan` skill** (Skill tool) with `rework #N: [feedback]` — it drafts the linked issue (`Rework of #N` body line, backlink comment on `#N`, milestone, sprint-file line) and confirms with the user before creating.
3. The original's disposition: if its PR is **merged/closed**, it stays shipped — do **not** mark `✓accepted` (the rework issue carries the open question; this line simply stays un-accepted with its history in Zone 2). If its PR is still **open**, ask: leave the PR open pending the rework, or close PR + branch (the rework supersedes it)?
4. Report: `↻ #[N] → rework tracked in #[M]`.

**skip** — no verdict now; leave the line untouched and move on. (At sprint scope it stays in the pending list and will surface again at reconcile.)

**When a *later* task broke this one.** If verification shows `#43` shipped exactly what it promised but a subsequent issue (`#46`) bypassed, rewired, or broke it, the verdict on `#43` is **not** rework — it delivered, and its record is intact. Record the finding in `#43`'s Zone 2 with its `Caught by:`, then raise the rework against **the issue that caused it** (`replan` with `rework #46: [what it broke in #43]`), cross-linked both ways. Attributing the regression to `#43` would send the fix to the wrong code and leave the real cause unreviewed. Whether `#43` is then accepted is the human's call — say plainly that it shipped correctly and is currently defeated, and let them decide.

---

## Task scope — `review <issue>`

1. **Resolve context.** Find the sprint file containing `#N`'s line (active sprint first, then highest sprint file). Extract `$REPO`. If no sprint file lists `#N` but `work/issue-N/` exists, proceed with the repo from the state file/master plan and note the sprint-file gap (the `✓accepted` marker then has nowhere to land — acceptance is recorded in Zone 2 only).
2. **Guard.** If a **live** `run` lock holds `#N`, stop: `⚙ run is still executing #[N] — review it when it lands.` A live lock on a *different* issue doesn't block. If `#N`'s line already carries `✓accepted`, say so and ask whether to re-review (a re-accept just updates nothing; a rework is always allowed).

   **If `#N` is blocked** (a state file for it still sits in `state/`, with no live lock) there is nothing shipped to accept — the run stopped partway. Don't run the task conversation on a half-built issue; report what happened and hand back:

   > ⏸ #[N] didn't finish — the run stopped at phase **[phase]**: [blocker reason from the state log].
   > Resume it with `/devloop:run [N]`, or tear it down with `/devloop:abort [N]`. There's nothing to review yet.

   Stop.
3. Run the **task conversation** above.
4. Close with a one-line status and the natural next step: more tasks to review (list un-accepted, executed issues), `/devloop:sprint` if unstarted work remains, or `/devloop:review` for the sprint ceremony when everything is accepted.

No milestone, tag, retro, or master-plan writes at task scope.

---

## Sprint scope

### Step 0 — Resolve sprint and repo

**Sprint.** If `$ARGUMENTS` gave a sprint number, use it as `$SPRINT_N`. Otherwise:
- Read `.context/sprints/master-plan.md` if it exists. Find the entry with `- **Status:** active` and use its sprint number. If multiple are active, use the highest and note it. If none is active, use the highest sprint number in the Sprint Map.
- If the master plan does not exist, scan `.context/sprints/` for `sprint-N.md` and use the highest N.

If no sprint can be resolved:

> No sprint files found. Run `/devloop:plan` to start a sprint before there's anything to review.

Stop.

**Read the sprint file** `.context/sprints/sprint-[N].md`. If it does not exist:

> Sprint [N] file not found at `.context/sprints/sprint-[N].md`. Nothing to review — check the sprint number.

Stop. Extract `$SPRINT_GOAL`, `$SPRINT_DEMO` (the `**Demo:**` line, if present), `$MILESTONE_NUMBER`, `$REPO`, `$CREATED`, and the ordered issue lines — parsing each per the `plan-spec.md` line grammar: checkbox, title, labels, and the trailing `⚠ unassigned` / `✓accepted <date>` annotations.

**Already completed?** If the master plan marks this sprint `- **Status:** completed`:

> Sprint [N] is already marked completed in the master plan. I can still regenerate the retrospective and re-check the milestone, but I won't re-close anything. Continue? (y/n)

On **n**, stop. On **y**, proceed but treat the close actions in Step 5 as idempotent (skip what's already done).

**Repo reachability.** Verify `$REPO` exists via GitHub MCP. If it fails:

> Could not reach `$REPO` — [error]. GitHub reconciliation and milestone close need it. Check the repo name and your token, then retry — or continue with **local-only** review (retro + master-plan status, no GitHub changes)? (retry / local)

On **local**, set `$GITHUB_UNAVAILABLE = true` and skip every GitHub/milestone call later, noting the omission in the report. (Local-only also disables the merge/rework actions — verdicts can still be recorded, and demos still run.)

### Step 1 — Preconditions and snapshot

**Active-run guard.** Read `.context/sprints/state/.lock` if it exists. Read its `holder` field (a missing field predates it — treat as `run`) and determine PID liveness with `kill -0 <pid> 2>/dev/null` (exit 0 = alive).

- **Live PID, `holder: pr-fix`** — a pr-fix is editing a PR's tree. It doesn't execute a sprint issue, so it doesn't block the close, but a PR is mid-edit: note it (`⚙ pr-fix is active on PR #[pr] — proceeding; review won't touch it. Its fixes won't be reflected until it pushes.`) and continue.
- **Live PID, `holder: run`, locked issue is in this sprint** — a run is mid-flight:

  > ⚙ `run` is active on #[N] (PID alive). A sprint can't be reviewed and closed while an issue is still executing. Finish that run, or `/devloop:abort` it, then re-run `/devloop:review`.

  Stop.
- **Live PID, `holder: run`, locked issue is in a different sprint** — note it (`⚙ run is active on #[N] of another sprint — proceeding; this review won't touch it.`) and continue.
- **Stale lock** (dead PID) — note it: `⚠ Found a stale lock (`[holder]`[, issue/PR #N]) — the next /devloop:run clears it; review leaves it untouched.` Continue.
- **Absent** — continue.

**Gather GitHub state** (skip all of this if `$GITHUB_UNAVAILABLE`):
- For each sprint issue number, fetch its state (`open` / `closed`) via GitHub MCP.
- List the repo's PRs (paginate past 100) and map each sprint issue to a merged or open PR the way `status` does — head branch `feat/issue-N-` or `fix/issue-N-` (N anchored by a trailing `-`), or a `Closes #N` / `Fixes #N` body keyword (N anchored by a non-digit/end). Record `$PR_MAP[N]`.
- Read milestone `$MILESTONE_NUMBER` via the **bundled github-extras MCP's milestone-listing operation** (`owner`, `repo`, `state: all` — it may already be closed by an earlier run of this skill), taking the entry with that number: `$MILESTONE_DUE` (from `due_on` — the ISO date, or `no due date` when null), `$MILESTONE_OPEN` (`open_issues`), `$MILESTONE_CLOSED` (`closed_issues`), and its current `state` (`open`/`closed`). The **official** GitHub MCP has no milestone tools — don't look for one there. If the read fails or returns no such milestone, treat these as `unknown` and say so in the header; never fill them in from the sprint file or from memory.

**Read the baseline.** Read `.context/devloop-baseline.md` if it exists — the accepted-failing allowlist. Collect entries whose `tracking:` issue is still open (carry-over debt) and any `added-by: issue #X` where X is in this sprint (debt this sprint introduced).

**Look for halted runs.** List `.context/sprints/state/issue-*.md`. A state file still sitting in `state/` means that issue is **mid-flight**: `run` archives that file to `work/run-state-final.md` on completion, so its presence means completion never happened. With no live lock, that is a run that stopped — almost always an auto-mode **stop-the-line** (coder stuck, an unfixable failure, a design still `needs-work`, a conflict, a manual task). Read its `## Log` for the blocker reason and its `phase:` for how far it got.

**Classify each issue** using the first matching rule:

| Priority | Condition | Class |
|---|---|---|
| 1 | GitHub state `closed` | **shipped** |
| 2 | Checkbox `[x]`, GitHub `open` | **done ⚠** (merged without a `closes` keyword, or closed-issue drift) |
| 3 | Checkbox `[x]`, GitHub unavailable | **shipped** (local belief) |
| 4 | Checkbox `[ ]`, a state file in `state/` | **blocked ⏸** — the run started and stopped. Carry its reason and `phase:` |
| 5 | Checkbox `[ ]`, GitHub `open`, no state file | **unfinished** (never started) |

**blocked ⏸ vs unfinished is a real distinction, not a cosmetic one.** An unfinished issue is one nobody got to. A blocked issue is one the AI *tried*, got partway through, and deliberately stopped rather than fake a judgment — with a logged reason and resumable state on disk. Collapsing them would throw away the most informative thing an autonomous run produces when it fails, and would invite the human to "carry it over" when the right move is usually to read the reason and resume.

Independently, each issue is **accepted** (line carries `✓accepted`) or **pending review**. Shipped-but-pending is the normal state after an autonomous `sprint` run — closed means *merged*, not *reviewed*.

**Collect the risk signals** for each executed issue, from its `work/issue-N/context.md` Zone 2 and `run-state-final.md`. These are what tell the human *where to spend attention*. The left column is what you look for in the record; **the right column is roughly what you say** — it is already in the human's language, so use it rather than the label:

| Signal in the record | What it means, and how to put it |
|---|---|
| a blocker was found at review | the test suite ran straight over a real bug and missed it |
| a blocker shipped `NOT-REPRODUCIBLE` | the bug is fixed, but no test proves it stays fixed |
| an AC is still `needs manual verification` | one acceptance criterion couldn't be checked automatically — it needs your eyes |
| a failure was baselined | a known-broken test shipped, on purpose, tracked in #X |
| a task took **3 coder attempts** | this one fought back — struggle tends to leave fragile code |
| the `critique` caught a bug pass 1 missed | the first review pass missed a bug here; the second one caught it |

Present a read-only snapshot (no gate yet):

> ## Sprint [N] review — _"[SPRINT_GOAL]"_
>
> Repo: [owner/repo] · Milestone #[number] ([MILESTONE_CLOSED] closed / [MILESTONE_OPEN] open · due [MILESTONE_DUE]) · Created [date]
>
> | # | Title | Area | Class | PR | Reviewed | ⚠ |
> |---|-------|------|-------|----|----------|---|
> | #44 | Add session persistence | infra | shipped | #10 | ✓accepted 07-08 | — |
> | #43 | Add JWT middleware | api | shipped | #12 | pending | **bug fixed but not covered by a test · 1 criterion needs your eyes** |
> | #45 | Add rate limiting | api | shipped | #13 | pending | — |
> | #46 | Cache warm-up | infra | **blocked ⏸** | — | — | got stuck building it — 3 tries, then stopped |
> | #42 | Add login page | web | unfinished | — | — | — |
>
> **[K] shipped · [B] blocked · [M] unfinished · [D] done ⚠** ([X] of [T] complete) · **[A] accepted · [P] awaiting review**
> Known-failing debt still open: [count] ([list tracking issues] — or "none")
>
> **Worth your attention:** #43 [and …] — the rest ran clean.   ← omit if no issue carries a ⚠

The **⚠ column is the point of this table.** Say plainly which tasks are worth walking and which ran clean, so the human can spend their attention where the run itself says it was uncertain — rather than opening all eight to find the two that mattered. A blank ⚠ is a genuine "this one was boring," and the human should feel safe waving it through.

Write the ⚠ cells the way the sample does: **a short plain phrase, not the record's label.** This table is the first thing the human reads and often the only thing they read closely; a cell reading `blocker fixed untested` or `coder stuck (phase: build, task 2)` asks them to learn devloop's vocabulary before they can find out whether their project is in trouble. Keep the phrase under about eight words — the detail belongs in the walkthrough, where they can ask for it.

### Step 1.5 — Walkthrough *(human gates — the sprint review proper)*

Runs when any executed issue (shipped / done ⚠) is **pending review**. Skip silently when all are accepted or nothing has shipped.

**Open with the sprint demo.** If the sprint file has a `**Demo:**` line:

> **Promised demo:** _"[SPRINT_DEMO]"_
> Want to trial it now? I can start the app ([dev-server from the profile]) and walk you through it — or we go task by task first.

Record informally how the increment held up — it feeds the retro's **Increment delivered** line.

**Walk each pending issue in execution order**, running the **task conversation** (shared core above) for each. Between tasks, keep a one-line progress trail (`3 of 5 reviewed · 2 accepted · 1 rework`). Let the ⚠ column set the pace: the clean ones should go fast.

**After the walkthrough**, if any **rework issues** were spawned, the sprint now has fresh unstarted work. Fork:

> [R] rework issue(s) were added to this sprint: [#52, #54]. Two ways to go:
> - **execute first** — pause the review here; run `/devloop:sprint` (or `/devloop:run`) to build the rework, then re-run `/devloop:review` to finish.
> - **close anyway** — continue to reconcile; the rework issues will be carried over to the next sprint.

On **execute first**, stop cleanly (nothing sealed yet — verdicts and Zone 2 entries persist; a re-run of review picks up where this left off, skipping `✓accepted` lines). On **close anyway**, continue.

### Step 2 — Reconcile issues *(human gate)*

Only runs if there are **blocked ⏸**, **unfinished**, or **done ⚠** issues. Decide the fate of each before sealing the sprint.

**done ⚠** — local says done, GitHub says open. Almost always a PR merged without a `closes #N` keyword. Default disposition: **close on GitHub**.

**blocked ⏸** — the run started, hit something it would not fake, and stopped with the reason logged and the state on disk. **Show the reason** — it is the whole value of a stop-the-line, and a human deciding this issue's fate without it is deciding blind. Default disposition: **resume**. Dispositions:
- **resume** *(default)* — the blocker is one a human can clear (answer the question, unstick the task, do the manual step). **Pause the review here** and hand off: `/devloop:run [N]` picks up from the recorded phase; re-run `/devloop:review` to finish. review does not execute work — same fork as the rework path in Step 1.5.
- **carry over** / **backlog** / **close** — as for unfinished, below. Choosing one of these on a blocked issue **abandons the run**: say so, and point at `/devloop:abort [N]` to tear down its branch and state cleanly rather than leaving them orphaned.

**unfinished** — open and never started (including rework issues you chose not to execute now, and skipped-verdict issues that never executed). Offer a disposition per issue:
- **carry over** — keep open; **remove it from this milestone** so the next sprint can select it (the `issue-selector` only sees issues with no milestone).
- **backlog** — relabel `type:backlog` and remove it from this milestone, sending it back to the backlog pool for `/devloop:plan` to re-triage.
- **close** — close on GitHub as out of scope, with a comment.
- **keep in milestone** — leave it open and assigned (it will show as an open issue under a closed milestone). Allowed but discouraged; note it in the retro.

Present the gate with proposed defaults:

> **Reconcile Sprint [N] — [n] issue(s) need a decision**
>
> | # | Title | Class | Why | Proposed |
> |---|-------|-------|-----|----------|
> | #46 | Cache warm-up | blocked ⏸ | got stuck on the second build step after 3 tries | **resume** |
> | #42 | Add login page | unfinished | never started | carry over |
> | #52 | Fix toast on slow networks (rework of #44) | unfinished | never started | carry over |
> | #51 | Update readme | unfinished | never started | backlog |
> | #44 | Add session persistence | done ⚠ | merged without a `closes` keyword | close on GitHub |
>
> Decide each: **resume** (blocked only) / **carry over** / **backlog** / **close** / **keep**.
> Reply with bulk or per-issue decisions (e.g. "resume #46, carry over the rest"):

If any issue is resolved as **resume**, stop cleanly after applying the other dispositions — nothing is sealed (no retro, no tag, no milestone close). Verdicts and Zone 2 entries already recorded persist; a re-run of `/devloop:review` picks up where this left off.

Wait for the response. Accept bulk and per-issue decisions in any combination. Re-present the resolved dispositions once for a final confirmation:

> Dispositions: #42 carry over · #52 carry over · #51 → backlog · #44 close. Apply these? (y / adjust)

**Apply** on confirmation (skip GitHub calls if `$GITHUB_UNAVAILABLE`, recording them as deferred in the report):
- **resume** — no GitHub call and **no file change**: the issue's state file and branch are left exactly as `run` left them. Hand off and stop.
- **carry over** — clear the issue's milestone (see below). Leave the checkbox unticked.
- **backlog** — add the `type:backlog` label, then clear the milestone (see below).
- **close** — close via GitHub MCP with a comment: `Closed at Sprint [N] review — [out of scope / superseded].` For a **done ⚠** issue, the comment is `Closing — delivered in PR #[pr] (merged without a closes keyword).`
- **keep** — no GitHub call.

**Clearing a milestone** — use the **bundled github-extras MCP's milestone-assignment operation** with `milestone_number: null` (plus `owner`, `repo`, `issue_numbers`). Passing null is what removes the issues from their milestone. The **official** GitHub MCP cannot do this — its issue-update milestone field takes a number and rejects null, and omitting the field leaves the existing milestone untouched — so do not go looking for it there, and do not shell out to `gh`.

This is **the mechanism, not a detail**: the `issue-selector` only sees issues with *no* milestone, so a carry-over whose milestone is never cleared is invisible to the next `/devloop:plan` and silently falls out of the process. It doesn't carry over — it disappears. If the clear fails, the issue is **not** carried over; report it as such rather than as a success.

If any call fails:

> Failed to [action] #[N]: [error]. Retry? (y/n) — if no, it's left as-is and noted in the report.

Wait for the response; retry once on **y**, otherwise leave it and note it.

Carried-over and backlog issues are **not** ticked in the sprint file — they remain genuinely unfinished. The sprint file is a historical record of this sprint; review does not rewrite its checkboxes (only `run` ticks a box on completion; review's only line edit is the `✓accepted` annotation).

### Step 3 — Retrospective *(human gate)*

Draft `.context/sprints/sprint-[N]-review.md`. Derive a script timestamp for the close date:

```
node -e "console.log(new Date().toISOString().slice(0,10))"
```

Use it as `$CLOSED_DATE`. Build the draft from observable data — shipped issues and their PRs, the walkthrough verdicts, the reconciliation dispositions just made, the open known-failing debt, and the **`Caught by:` tallies** from each issue's Zone 2 timeline (which gate found which defect) — then invite the user to add the qualitative reflection that only they have.

**Count, don't estimate.** The Loop calibration table is derived by reading the `Caught by:` fields across the sprint's `work/issue-*/context.md` Zone 2 timelines. If a run predates the field, or an issue's timeline doesn't record it, say `unknown: [n]` rather than inferring which gate probably caught something — a made-up tally is worse than an incomplete one, because the whole purpose of the section is to tell you which gates are real.

```markdown
# Sprint [N] Review

**Goal:** [SPRINT_GOAL]
**Demo:** [SPRINT_DEMO]      ← omit this line if the sprint file had no Demo
**Milestone:** #[milestone_number]
**Repo:** [owner/repo]
**Period:** [CREATED] → [CLOSED_DATE]
**Outcome:** [K] of [T] issues shipped · [A] accepted at review[ · [R] rework issue(s) spawned]

## Increment delivered      ← omit this whole section if the sprint file had no Demo
**Promised:** [SPRINT_DEMO]
**Delivered:** [yes — the increment is demoable as promised / partially — what's watchable vs. what slipped / no — why not]

## Shipped
- #[N] — [title] (PR #[pr]) — accepted [date]      ← one line per shipped issue; "(no PR)" for design/scaffold/manual closes; "→ rework #[M]" where a rework was spawned
- #[N] — [title] (PR #[pr]) — ⚠ not individually reviewed      ← shipped issues whose verdict was skipped

## Carried over / deferred
- #[N] — [title] → carried to next sprint
- #[N] — [title] → returned to backlog
- #[N] — [title] → closed (out of scope)
- #[N] — [title] → ⏸ **blocked at [phase]** ([reason]) — run abandoned, carried over   ← blocked issues not resumed
(— "None" if the sprint shipped clean —)

## Known-failing debt
- [check] [test] — tracking #[issue]    ← baseline entries still open
(— "None" —)

## Loop calibration
Which gates actually caught the defects this sprint — tallied from the `Caught by:` fields in each
issue's Zone 2 timeline. A gate that never fires is either unnecessary or not working; a gate that
catches most of the bugs is the one to invest in. Neither is knowable without this record.

| Gate | What it does | Defects caught |
|---|---|---|
| test-red | watches the new test fail before any code is written | [n] |
| typecheck / lint | the compiler and the linter | [n] |
| reviewer (pass 1) | first read of the diff | [n] |
| critique (pass 2) | re-reads pass 1, and can raise what it missed | [n] |
| validation | traces each acceptance criterion to code that actually runs | [n] |
| demo (at review) | runs the change through the real entry point | [n] |
| human (at review) | you, in this conversation | [n] |

- **Never fired:** [gates with zero catches this sprint — or "none"]
- **Bugs fixed with no test proving the fix holds:** [blockers recorded NOT-REPRODUCIBLE, with the reason — or "none"]
- **Process feedback:** [anything the human said about the loop itself during the walkthrough, verbatim — or "none"]

## Retrospective
**What went well:**
- [drafted from signals — e.g. "all api issues shipped", or leave a prompt for the user]

**What to improve:**
- [drafted from signals — e.g. "2 issues carried over; sprint may have been over-scoped", "1 known-failing test still open", "2 shipped tasks needed rework — acceptance criteria may be under-specified"]

**Notes:**
- [anything the user wants to record]
```

Present the draft and invite edits:

> **Sprint [N] retrospective — draft**
>
> [render the draft]
>
> The **Shipped / Carried over / Known-failing / Loop calibration** sections are filled from the data. Confirm the **Increment delivered** line — did the sprint produce the demo it promised? — and add or refine the **What went well / improve / Notes**: what should the next sprint carry forward? Confirm to write, or tell me what to change:

Wait for the response. Apply edits, re-present if substantially changed, then write `.context/sprints/sprint-[N]-review.md` on confirmation:

> Retrospective written to `.context/sprints/sprint-[N]-review.md`.

### Step 4 — Tag the release *(human gate)*

A tag is the **standard close of a devloop sprint**: under autonomous execution `main` advanced continuously as each issue merged, so the milestone-boundary tag is what marks a stable, named release point — integration and release stay decoupled. Propose it (the user can still skip):

> Tag this release. Proposed: `sprint-[N]` (or a semver like `v0.[N].0`) — confirm a name, or `skip`:

On **skip**, note it in the report and continue. Otherwise:
- Confirm the tag name and an optional message, then create an **annotated** tag on the current `HEAD` of the base branch: `git tag -a <name> -m "<message>"`. Do not push automatically.
- Ask whether to push it:

  > Tag `<name>` created locally. Push it to `origin`? (y/n)

  On **y**, `git push origin <name>`. On **n**, leave it local and note it.

If the tag already exists, report it and ask for a different name or to reuse it. If `HEAD` is not on the base branch, note which commit will be tagged before creating it.

### Step 5 — Close the sprint

The sealing actions. Re-confirm before the milestone close, since it's the irreversible-ish, outward-facing step:

> **Close Sprint [N]?**
>
> - Milestone #[milestone_number] → **closed** on GitHub
> - Master plan → Sprint [N] `Status: completed`
> [- ⚠ [n] issue(s) are still open under this milestone (kept) — they'll sit under a closed milestone]   ← only if any "keep" disposition was chosen
> [- ⚠ [n] shipped issue(s) were not individually accepted — closing anyway records them as shipped-unreviewed]   ← only if walkthrough verdicts were skipped
>
> Confirm to close the sprint (y / n):

On **n**, stop here — the retro, verdicts, and tag are already saved; the sprint stays open. On **y**:

1. **Close the milestone** via the bundled github-extras MCP's close-milestone operation (`owner`, `repo`, `milestone_number`). Skip if `$GITHUB_UNAVAILABLE` or the milestone is already closed (note it). If it fails:

   > Failed to close milestone #[milestone_number]: [error]. Retry? (y/n) — if no, the master plan is still updated and you can close the milestone on GitHub manually.

   Retry once on **y**.

2. **Mark the master plan completed.** In `.context/sprints/master-plan.md`, find the `### Sprint [N]` entry and set its `- **Status:** completed`. Preserve the theme, `Goal:`, `Demo:`, and `Sprint file:` lines verbatim. If the entry is missing (master plan drifted), append a minimal `### Sprint [N]` entry with `Status: completed` and the `Sprint file:` line.

3. **Auto-clean resolved baseline.** For any `.context/devloop-baseline.md` entry whose `tracking:` issue is now **closed**, offer to remove it:

   > These known-failing entries track issues that are now closed: [list]. Remove them from the baseline? (y/n)

   On **y**, drop those entries. Leave entries with still-open tracking issues — they're real carry-over debt and already appear in the retro.

### Completion report

> **✅ Sprint [N] closed** — _"[SPRINT_GOAL]"_
>
> Shipped [K] of [T] · accepted [A] · [rework spawned [R] · carried over / backlog / closed counts]   ← omit zero counts
> Milestone #[milestone_number]: [closed / already closed / ⚠ not closed — see above]
> Retrospective: `.context/sprints/sprint-[N]-review.md`
> [Tag: `<name>` [pushed / local]]   ← omit if skipped
>
> [If GitHub was unavailable: ⚠ GitHub changes were skipped — close milestone #[number] and reconcile [issues] manually.]

Then suggest the next step:
- If carried-over or backlog issues exist → `Next: /devloop:plan to scope Sprint [N+1] (your carried-over issues are back in the pool).`
- Otherwise → `Next: /devloop:roadmap to set the next sprint's theme, then /devloop:plan to scope it.`

---

## Exception handling

- **GitHub MCP failure** (issue fetch, relabel, close, merge, milestone close) — report it; offer **retry once** or to continue and note the skipped action in the report. A milestone-close failure never blocks the master-plan update — the local record of completion still stands.
- **Active run on this sprint** — task scope: only blocks reviewing the locked issue. Sprint scope: stop in Step 1; a sprint can't be sealed while an issue is executing.
- **Blocked issue** (state file in `state/`, no live lock — a run that stopped rather than fake a judgment) — task scope: report the blocker and hand back to `run`/`abort`; there is nothing shipped to review. Sprint scope: class **blocked ⏸**, default disposition **resume**, which pauses the close. Never silently reconcile a blocked issue as if nobody had started it — the logged reason is the most useful thing an autonomous run produces when it fails.
- **A recorded SHA or ref doesn't resolve** — `history-ref: refs/devloop/issue-N` is written by `run` on the machine that executed the sprint and is never pushed, so it is absent in a fresh clone; a run that predates the archive step has none at all. Say so, work from the merge commit and Zone 2, and never reconstruct a diff you could not read.
- **The demo can't be run** — no entry point, credentials the environment doesn't have, or an issue with no runtime surface (design, manual, scaffold). Say why and continue without it. Never illustrate output you did not observe.
- **Merge fails during a task accept** — the acceptance is already recorded in Zone 2; surface the failure and re-run `run [N]` after the user resolves it. Don't mark `✓accepted` until the merge lands.
- **Master-plan entry missing for Sprint [N]** — append a minimal `### Sprint [N]` entry with `Status: completed` rather than failing.
- **Tag already exists / detached HEAD** — surface it in Step 4 and ask for a new name or which commit to tag; never force-move an existing tag.
- **Re-running on an already-completed sprint** — allowed; regenerate the retro and re-check the milestone, but skip actions already done (idempotent close). `✓accepted` lines are never re-reviewed unless the user asks.
- **Interrupted mid-review** — safe: verdicts (`✓accepted` lines, Zone 2 entries) and the retro persist as written; a re-run skips accepted lines and re-presents only what's pending.
