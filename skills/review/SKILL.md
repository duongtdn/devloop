---
description: The outer-loop review conversation, at two scopes. Pass an issue number (e.g. /devloop:review 42) for a task review — the AI explains what was built, which files it produced and changed, and why; optionally walks you through the implementation decision by decision with citations to the code and docs; you demo and ask questions, then accept it (merging its PR if still open) or request rework as a new linked issue. Pass nothing (or a sprint number) for a sprint review — walk every not-yet-accepted task the same way, then reconcile remaining issues, write the retrospective, tag the release, close the GitHub milestone, and mark the sprint completed. Conversational — pauses at every human gate.
---

You are running **devloop:review**. This is the **outer loop** of devloop's human-on-the-loop workflow: the autonomous inner loop (`run --auto`, `sprint`) executes and logs; here the human inspects the result in conversation and passes judgment. It is scope-aware:

- **Task scope** — `review 42` / `review #42`: one task. Explain → optional walkthrough → demo → Q&A → **accept** (merge if the PR is still open, mark accepted) or **request rework** (a new linked issue via `replan`).
- **Sprint scope** — `review` (or `review 3` matching a *sprint* number only when no issue state/work dir exists for it — prefer `sprint-3` to be explicit): walk every not-yet-accepted task with the same conversation, then run the close ceremony (reconcile → retrospective → tag → close milestone).

**Altitude.** review is **product acceptance** — "is this the right thing? show me." Line-level code review is `pr-review`'s job; the inner loop already ran the `reviewer` agent autonomously. Hand off to `/devloop:pr-review` when the user wants a code-level deep-dive.

**Conversational.** Pause at every human gate and wait for explicit confirmation. Closing a milestone, merging a PR, and relabelling/closing issues are outward-facing GitHub actions — confirm before each.

**Scope of writes.** review owns the **acceptance verdicts** (`✓accepted` in the sprint file, per `plan-spec.md` §3), the retro document, the git tag, the milestone state, and the master-plan `Status`. It does **not** execute work or change the sprint's composition itself — rework and plan changes route through `/devloop:replan`, backlog ideas through `/devloop:backlog`, and a merge through `run`'s merge phase. Never fabricate a GitHub call result — if a tool can't be found or a call fails, stop and report.

Parse `$ARGUMENTS`: an issue reference (`42`, `#42`) → **task scope** with `$ISSUE`; `sprint-3` / `s3` / empty → **sprint scope** (number = `$SPRINT_N` if given). A bare number is a *task* review if `.context/sprints/work/issue-N/` or a sprint-file line for `#N` exists, else treat it as a sprint number and warn.

---

## The task conversation (shared core)

Both scopes review a single task the same way. `review <issue>` runs it once; the sprint walkthrough runs it per pending task.

### 1 · Gather

For issue `#N` (with `$REPO` and the sprint file already resolved):

- **Issue** — fetch title, state, body (`## Acceptance Criteria`, `## Definition of Done`) via GitHub MCP.
- **Work artifacts** — from `.context/sprints/work/issue-N/`: `context.md` **Zone 2** (the decision timeline — the primary source for *what was decided and why*), `plan.md`, `design.md` if present, `run-state-final.md` (or the live state file if the run halted at `pending-review`).
- **PR** — from the state file's `pr:` or by matching head branch `feat/issue-N-`/`fix/issue-N-` (N anchored by a trailing `-`) or a `Closes #N` keyword. Record `$PR_STATE` (merged / open / none — design, scaffold, and manual issues have none).
- **Verification record** — from Zone 2 and the state log: which ACs were auto-verified (unit/e2e), which were flagged `needs manual verification` (an auto run carries these into the PR body), anything baselined, any blocker entries.
- **Detection record** — from Zone 2's **`Caught by:`** fields: for each defect the run hit, *which gate found it* (`test-red` / `typecheck` / `lint` / `reviewer` / `critique` / `validation` / `spike` / `human`), how many attempts a task took, and whether any blocker shipped `NOT-REPRODUCIBLE` (fixed without a regression test, and why). The raw evidence — failing output, stack traces — sits in `work/issue-N/logs/`, cited under **Artifacts**. **Note the paths; do not read them now.** They are opened on demand, when the human asks to see a failure.
- **Changed artifacts** — the files the task actually touched, as a status + path list (`A` / `M` / `D`), never the patch bodies. Where to read them depends on the delivery path recorded in the state file:
  - **`delivery: pr`** — the PR's changed-files list via GitHub MCP.
  - **`delivery: direct`** — the squash merge commit carries `Closes #N`: `git log --grep="Closes #[N]" -1 --name-status --format=%H` on `$base`. If the run halted before merge and the branch still exists, `git diff --name-status $base...$branch`.
  - **scaffold** — the `scaffolder` committed straight to `$base`; read its commits the same way (`git log --name-status`), bounded by the run's start timestamp in the state log.
  - **design / manual** — no code changed; the produced artifact is `design.md`, or (manual) the recorded confirmation itself. Say so plainly rather than showing an empty list.
- **Project records the run wrote** — from Zone 2 / the state log: fields filled in `.context/devloop-profile.md`, entries added to `.context/devloop-baseline.md`. These are shared records the task changed as a side effect, and they are easy to miss in a diff.

Do not load whole diffs or the full design into context — summarize from Zone 2 and link the files; the user opens what they want.

### 2 · Present

> **Task review — #[N]: [title]**   ([workflow] · PR [#pr merged | #pr open | none])
>
> **What was built:** [2–4 sentences from plan.md + Zone 2 — the delivered behavior, in product terms]
>
> **Key decisions:** [the 2–4 load-bearing Zone 2 decisions — approach chosen, findings applied/dropped, anything baselined — each with its one-line why]
>
> **Acceptance criteria:**
> - [x] [criterion] — verified (unit)
> - [x] [criterion] — verified (e2e)
> - [ ] [criterion] — ⚠ needs manual verification
>
> [⚠ flags: blockers hit, known-failing entries added, `needs manual verification` items — omit if none]
>
> **Artifacts**
> - _Added_ — `src/auth/jwt.ts` (the middleware), `tests/auth/jwt.test.ts` (12 unit cases)
> - _Changed_ — `src/server.ts` (mounts the middleware), `docs/api.md` (auth section)
> - _Deleted_ — `src/auth/legacy-session.ts` (superseded — see decision below)
> - _Project records_ — profile: `e2e-test` command filled · baseline: +1 known-failing (tracking #77)
> - _Process record_ — PR #[pr] · `work/issue-N/` (plan, design, context)
>
> Try it, ask me anything, or give your verdict — **walk me through it** / **accept** / **rework: [feedback]** / **skip** (decide later):

Each changed file gets a **short role phrase**, not a bare path — what it is or why it moved, drawn from `plan.md`'s tasks and Zone 2. A path alone tells the reviewer nothing they couldn't get from `git show`. Deletions and renames are called out explicitly: they're the changes a reader is most likely to be surprised by. Keep the list to ~10 entries; collapse the tail by directory (`+6 more under src/api/`). Omit any sub-line that's empty (no deletions → no _Deleted_ line), and omit the whole block for a manual issue with no code.

### 3 · Walk through *(optional — the human opts in)*

The panel above says *what* landed. A walkthrough says *how it was built and why*, in order, so the human can actually understand the change rather than take it on trust. Zone 2 is a full decision transcript, so this is a replay of what happened, not a reconstruction.

**It is always optional.** Offer it once, in the verdict prompt (`walk me through it`), and never insist — for a small, obvious task the human should go straight to a verdict. They can also ask for it later, mid-conversation, or bail out of it at any point (`enough`) and land back at the verdict prompt.

**Rules of the replay:**
- **Every claim traces to an artifact on disk** — a Zone 2 entry, `plan.md` / `design.md`, a commit, a file, an issue AC, a doc section. Cite as you go: `src/auth/jwt.ts:42`, `plan.md` task 2, `#42` AC 3.
- **Read a file before citing a line in it.** A line number you didn't verify is worse than no citation.
- **Where Zone 2 records no rationale, say so** — "the log doesn't say why" — and never supply one yourself. A plausible after-the-fact reason is exactly the failure this audit trail exists to prevent; it would make every other citation untrustworthy too.

**Shape — a conversation, not an essay.** One beat at a time, 2–5 sentences plus its citations, then stop and ask. Beats, in build order:

1. **The frame** — what `#N` asked for, and the approach the `planner` chose over what alternative. If a design phase ran: the decision, the critique's score against its criteria, and any `coder` spike evidence that settled a load-bearing assumption.
2. **Each task from `plan.md`, in order** — the scenario the test-writer encoded first (`test-plan.md` → `tests/…:NN`), that the test was **seen to fail** before any code was written (the `red` check), the code that made it pass (`src/…:NN`), and anything notable in between: **how many attempts it took** and what failed on each, a narrow-interface round-trip that widened a production type, a missing-command round-trip, a divergence from the plan and its recorded reason. A task that needed three attempts is worth more of the human's time than one that went green first try — say so rather than flattening them into the same "done."
3. **How each bug was caught** — for every defect the run hit, name the gate that found it, from the `Caught by:` field: a red test, the type checker, the `reviewer`, the `critique` (a bug the first review pass missed), a spike. Then which findings were applied, which were dropped, and the recorded reason for dropping them. **This is the part a human cannot reconstruct for themselves** — and it is what tells them whether the safety net that caught this bug was the one they thought it was. If a blocker shipped without a regression test (`NOT-REPRODUCIBLE`), say so and give the reason.
4. **What was deferred** — baselined failures and their tracking issues, ACs still marked `needs manual verification`, blockers an auto run logged instead of escalating.

End each beat with the handoff: **questions on this?** — or `next` / `jump to [topic]` / `show me the code` / **`show me the failure`** / `enough`. Follow the human's lead: fetch the real diff, file, or commit on demand; open the captured log from `work/issue-N/logs/` when they want the actual failing output rather than your summary of it; go deeper wherever they push. When the walkthrough ends, re-present the verdict prompt from §2.

At sprint scope this is offered per task like everything else in the core — which is the point: the human walks the tasks they don't understand and waves through the ones they do.

### 4 · Converse

Free-form, human-led. Answer questions from the gathered artifacts (fetch deeper — a specific commit, a file, the diff — on demand). Offer a **trial demo** when the profile supports it: start the `dev-server` command from `.context/devloop-profile.md` (or name the relevant `e2e-test`) and tell the user what to click, per the issue's ACs. Any ⚠ `needs manual verification` item is the first thing to demo — the human closing that flag is exactly what the auto run deferred to this conversation.

Feedback that isn't accept/rework has homes — route, don't absorb:
- "we should also…" (new scope) → offer `/devloop:backlog` to capture it as a backlog issue.
- "the plan/roadmap should change" → `/devloop:replan` (sprint composition) or `/devloop:roadmap` (vision).
- "review the code itself" → `/devloop:pr-review`.
- **"the *process* should change"** — feedback about devloop's own loop rather than the product: a gate that fired too late, an agent that trusted something it shouldn't have, a check that never earns its keep. This is the most valuable feedback the outer loop produces and it has nowhere else to go, so **capture it verbatim** rather than reasoning it away — at sprint scope it lands in the retro's **Loop calibration** section; at task scope, record it in Zone 2 and carry it forward to the sprint retro. Do not silently convert it into a code change.

### 5 · Resolve

**accept** — the human signs off:
1. Derive `$NOW` (`node -e "console.log(new Date().toISOString())"`) and append a Zone 2 entry to `work/issue-N/context.md`: accepted at review, by whom (task/sprint scope), any manual ACs the user confirmed in the demo, notable Q&A outcomes, and whether a walkthrough was run (plus anything it surfaced — a gap in the log, a question the artifacts couldn't answer).
2. **If the PR is still open** (task-level flow): add the `status:reviewed` label to the PR — the documented solo-dev sign-off `run`'s merge phase recognises — then invoke the **`run` skill** for `#N` (Skill tool): it resumes at `pending-review` → merge, and owns rebase, merge method, issue close, checkbox tick, state archive, lock. If the merge phase reports a conflict or failure, surface it — the acceptance stands recorded in Zone 2; re-run `run` after resolution.
3. **Mark accepted:** append ` ✓accepted YYYY-MM-DD` (date from `$NOW`) to `#N`'s line in the sprint file, per the spec grammar. Never alter the line's other content.
4. Report: `✓ #[N] accepted[ — PR #[pr] merged]`.

**rework: [feedback]** — the shipped thing needs changes:
1. Confirm the feedback in one sentence ("So the rework is: [restated]. Right?").
2. Invoke the **`replan` skill** (Skill tool) with `rework #N: [feedback]` — it drafts the linked issue (`Rework of #N` body line, backlink comment on `#N`, milestone, sprint-file line) and confirms with the user before creating.
3. The original's disposition: if its PR is **merged/closed**, it stays shipped — do **not** mark `✓accepted` (the rework issue carries the open question; this line simply stays un-accepted with its history in Zone 2). If its PR is still **open**, ask: leave the PR open pending the rework, or close PR + branch (the rework supersedes it)?
4. Report: `↻ #[N] → rework tracked in #[M]`.

**skip** — no verdict now; leave the line untouched and move on. (At sprint scope it stays in the pending list and will surface again at reconcile.)

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

On **local**, set `$GITHUB_UNAVAILABLE = true` and skip every GitHub/milestone call later, noting the omission in the report. (Local-only also disables the walkthrough's merge/rework actions — verdicts can still be recorded.)

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
- Fetch milestone `$MILESTONE_NUMBER` via GitHub MCP for `$MILESTONE_DUE`, `$MILESTONE_OPEN`, `$MILESTONE_CLOSED`, and its current `state` (`open`/`closed`).

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

**Collect the risk signals** for each executed issue, from its `work/issue-N/context.md` Zone 2 and `run-state-final.md`. These are what tell the human *where to spend attention* — after an autonomous sprint they face a wall of shipped tasks, and the whole point of the outer loop is that their attention is scarce:

| Signal | Why it deserves a look |
|---|---|
| a blocker was found at review | the suite ran over a real bug and missed it |
| a blocker shipped `NOT-REPRODUCIBLE` | it was fixed with **no test proving the fix works** |
| an AC is still `needs manual verification` | the run could not verify it and deferred it to *this conversation* |
| a failure was baselined | known-broken code shipped, on purpose |
| a task took **3 coder attempts** | the AI struggled; struggle correlates with fragility |
| the `critique` caught a bug pass 1 missed | the first review pass was not sufficient here |

Present a read-only snapshot (no gate yet):

> ## Sprint [N] review — _"[SPRINT_GOAL]"_
>
> Repo: [owner/repo] · Milestone #[number] ([MILESTONE_CLOSED] closed / [MILESTONE_OPEN] open · due [MILESTONE_DUE]) · Created [date]
>
> | # | Title | Area | Class | PR | Reviewed | ⚠ |
> |---|-------|------|-------|----|----------|---|
> | #44 | Add session persistence | infra | shipped | #10 | ✓accepted 07-08 | — |
> | #43 | Add JWT middleware | api | shipped | #12 | pending | **blocker fixed untested · 1 AC unverified** |
> | #45 | Add rate limiting | api | shipped | #13 | pending | — |
> | #46 | Cache warm-up | infra | **blocked ⏸** | — | — | coder stuck after 3 attempts (phase: build, task 2) |
> | #42 | Add login page | web | unfinished | — | — | — |
>
> **[K] shipped · [B] blocked · [M] unfinished · [D] done ⚠** ([X] of [T] complete) · **[A] accepted · [P] awaiting review**
> Known-failing debt still open: [count] ([list tracking issues] — or "none")
>
> **Worth your attention:** #43 [and …] — the rest ran clean.   ← omit if no issue carries a ⚠

The **⚠ column is the point of this table.** Say plainly which tasks are worth walking and which ran clean, so the human can spend their attention where the run itself says it was uncertain — rather than opening all eight to find the two that mattered. A blank ⚠ is a genuine "this one was boring," and the human should feel safe waving it through.

### Step 1.5 — Walkthrough *(human gates — the sprint review proper)*

Runs when any executed issue (shipped / done ⚠) is **pending review**. Skip silently when all are accepted or nothing has shipped.

**Open with the sprint demo.** If the sprint file has a `**Demo:**` line:

> **Promised demo:** _"[SPRINT_DEMO]"_
> Want to trial it now? I can start the app ([dev-server from the profile]) and walk you through it — or we go task by task first.

Record informally how the increment held up — it feeds the retro's **Increment delivered** line.

**Walk each pending issue in execution order**, running the **task conversation** (shared core above) for each: gather → present → walk through (if asked) → converse → resolve (**accept** / **rework** / **skip**). Between tasks, keep a one-line progress trail (`3 of 5 reviewed · 2 accepted · 1 rework`).

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
> | #46 | Cache warm-up | blocked ⏸ | coder stuck after 3 attempts (phase: build, task 2) | **resume** |
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
- **carry over** — clear the issue's milestone via GitHub MCP (set milestone to none). Leave the checkbox unticked.
- **backlog** — add the `type:backlog` label and clear the milestone via GitHub MCP.
- **close** — close via GitHub MCP with a comment: `Closed at Sprint [N] review — [out of scope / superseded].` For a **done ⚠** issue, the comment is `Closing — delivered in PR #[pr] (merged without a closes keyword).`
- **keep** — no GitHub call.

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

| Gate | Defects caught |
|---|---|
| test-red | [n] |
| typecheck / lint | [n] |
| reviewer (pass 1) | [n] |
| critique (missed by pass 1) | [n] |
| validation | [n] |
| human (at review) | [n] |

- **Never fired:** [gates with zero catches this sprint — or "none"]
- **Shipped without a regression test:** [blockers recorded NOT-REPRODUCIBLE, with the reason — or "none"]
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
- **Merge fails during a task accept** — the acceptance is already recorded in Zone 2; surface the failure and re-run `run [N]` after the user resolves it. Don't mark `✓accepted` until the merge lands.
- **Master-plan entry missing for Sprint [N]** — append a minimal `### Sprint [N]` entry with `Status: completed` rather than failing.
- **Tag already exists / detached HEAD** — surface it in Step 4 and ask for a new name or which commit to tag; never force-move an existing tag.
- **Re-running on an already-completed sprint** — allowed; regenerate the retro and re-check the milestone, but skip actions already done (idempotent close). `✓accepted` lines are never re-reviewed unless the user asks.
- **Interrupted mid-review** — safe: verdicts (`✓accepted` lines, Zone 2 entries) and the retro persist as written; a re-run skips accepted lines and re-presents only what's pending.
