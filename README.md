# devloop

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Claude Code plugin that runs a full **sprint lifecycle** — plan, execute, review, close — from inside Claude Code, on top of your GitHub issues and milestones. Specialized sub-agents do the work; you decide how much of the driving to keep.

Devloop's north star isn't "let the AI build it for you." It's **move fast *without outsourcing your understanding* of your own software.**

That north star has two shapes. For developers, it's the sprint loop below. For someone who wants a small app and isn't going to write it, it's [`/devloop:vibe`](#a-third-way-in--devloopvibe) — same principle, different vocabulary: you never approve something you couldn't judge, and you run the demo yourself.

---

## The idea of Fast and Slow

AI can now write software faster than a human can follow it. The tempting move is to hand over the wheel completely. But if you outsource the *doing*, you quietly outsource the *understanding* too — and you end up the owner of a codebase you can't reason about. That debt compounds: every next decision is harder because you no longer hold the mental model.

Devloop's bet is that you can keep **both** — AI's speed *and* your grip on the system — if you're deliberate about **where the human spends attention.** So it runs at two speeds:

- **Fast** — let the AI run unblocked. This is where velocity comes from: it plans, writes tests, implements, reviews its own diff, opens (and can merge) PRs, all without stopping to ask.
- **Slow** — sit down *with* the AI and review, question, demo, and adjust. This is where **you build and refresh your mental model.** It's a conversation and a study session, not a rubber stamp.

The slow part never disappears — it just moves depending on how you work. And because everything the AI does on the fast path is **logged with its reasoning**, the slow review is genuine understanding, not archaeology. You come out the other side having shipped quickly *and* knowing what you shipped and why.

There's one thing the slow path can't fix on its own: the model you refresh at review lives in **your** head. It drifts as the system moves, and someone joining the team never had it. That's what [`/devloop:docs`](#docs-for-humans--devloopdocs) is for — the standing description of the system, written for people, and checked against the code rather than trusted.

That log records more than decisions. For every bug the run hit, it records **which gate caught it** — a failing test, the type checker, the code review, the second-opinion pass — and keeps the raw failing output on disk. So at review you can ask *"how did you catch this?"* and get an answer with the evidence attached, rather than a plausible story. It also means the loop can tell you, over a sprint, **which of its own checks are actually earning their keep** and which have never once caught anything.

---

## Two workflows

Both workflows share the same setup and the same close — they differ in **where you sit relative to the fast execution**, which is exactly what "in the loop" and "on the loop" mean. The default is in-the-loop; you opt into on-the-loop with `--auto` (per task) or `/devloop:sprint` (per sprint).

The diagrams below show the two ends of that spectrum — full control at every gate, and full autonomy across a whole sprint. They're illustrations, not the only shapes available; see [Mix and match](#mix-and-match-these-are-primitives-not-pipelines) below for how to run something in between.

### Human-*in*-the-loop — you ride every step

The AI does the work, but `/devloop:run` **pauses at each gate and waits for you** — approve the plan, the review findings, the PR. Slow and deliberate: you understand each decision because you make it *with* the AI. This is the default (plain `/devloop:run`, no flags).

```
  /devloop:roadmap    vision, themes, build/test profile      (once per project)
  /devloop:backlog    capture ideas as GitHub issues          (anytime, any chat)
        │
        ▼
  /devloop:plan       scope the sprint, create the milestone
        │
        ▼
  /devloop:run   ◄─── repeat for each issue
        │
        ├─ gate ▸ approve the plan + test strategy
        ├─ gate ▸ approve the review findings        ◄─ YOU decide, step by step
        ├─ gate ▸ approve the PR
        │
        └─ optional: /devloop:pr-review → /devloop:pr-fix   (code-level review)
        │
        ▼
  /devloop:review     retro · tag a release · close the milestone
        │
        └─► next sprint ─► /devloop:plan
```

**Best for:** when you want **control and early steering** — catching a wrong turn while it's still cheap to redirect, rather than after it's already built.

### Human-*on*-the-loop — you watch from above

`/devloop:sprint` (and `/devloop:run --auto`) **run without stopping** — at every point that would be a gate, the AI reasons to the best decision, applies it, and **logs it with the reasoning**. If it can't decide something safely (a stuck task, a conflict, work needing a human hand), it halts and tells you rather than guessing. **Picking a halted issue back up: re-run it without `--auto`** — `/devloop:run 42` resumes exactly where it stopped, in gated mode, and puts the decision in front of you. (Re-running *with* `--auto` resumes as autonomous and stops at the same wall — it was waiting for you, not for another attempt.) You meet the finished work at `/devloop:review`: it explains what it built and why, you demo and probe it, then **accept** or send it back as **rework**.

This is where the learning actually happens — not in a gate. A gate only ever asks "approve or not"; `review` is the deep conversation, backed by the full logged reasoning of everything the AI decided. That's why on-the-loop works just as well on unfamiliar or high-stakes work as it does on routine work — you're not skipping the understanding, you're meeting it in one concentrated sitting instead of six small ones.

```
  /devloop:roadmap    vision, themes, build/test profile      (once per project)
  /devloop:backlog    capture ideas as GitHub issues          (anytime, any chat)
        │
        ▼
  /devloop:plan       scope the sprint, create the milestone
        │
        ▼
  /devloop:sprint     Claude runs EVERY issue autonomously, merging each
        │             to main as it lands. No gates while it works, and
        │             every decision + reason is logged for your review.
        ▼
  /devloop:review     demo and question each shipped task:
        │
        ├─ accept ──────────────────────────────► ✓ marked accepted
        │
        └─ rework ─► /devloop:replan ─► new linked issue ─┐
        │                                                 │
        │      ◄──── re-run /devloop:sprint ◄─────────────┘
        ▼
  (all accepted)      retro · tag a release · close the milestone
        │
        └─► next sprint ─► /devloop:plan
```

**Best for:** velocity, whenever you're comfortable letting the AI run before you inspect what it did — the review conversation is what keeps you honestly informed, not the presence of gates.

### The two, side by side

|  | Human-in-the-loop | Human-on-the-loop |
|---|---|---|
| **Pace** | slow, step by step | fast run, then a focused review |
| **Where you sit** | inside every gate | above the run; meet it at review |
| **Execute with** | `run` (gated) | `run --auto`, `sprint` |
| **Your attention** | continuous | concentrated in `review` |
| **Understanding built** | as each decision is made | at review, from the logged reasoning |
| **Best for** | control, early steering | velocity |

Either way, **the slow, understanding-building conversation is a first-class part of the workflow** — never skipped, only relocated. That's the point: AI's leverage, without handing away the thing that makes you the architect of your own software.

### Mix and match — these are primitives, not pipelines

The two diagrams above show the ends of a spectrum for clarity, but every skill is an independent primitive — combine them at whatever granularity fits the moment. The loop doesn't have to run at sprint scale:

```
  /devloop:run 42 --auto     one issue, no gates, run to completion (merges locally, no PR)
        │
        ▼
  /devloop:review 42         demo and question just that task → accept or rework
        │
        ▼
  /devloop:run 43 --auto     repeat, issue by issue
```

That's on-the-loop working at **task granularity** — a tighter feedback loop than `/devloop:sprint`, with a smaller, fresher batch to review each time, and still no gates slowing execution down. You can go further still and mix the two workflows within one sprint: gate the one issue you're unsure about with plain `/devloop:run`, and `--auto` the rest.

The conversational skills aren't locked to any diagram either. **`/devloop:backlog` can be dropped into any conversation, any time** — the moment an idea or a bug surfaces mid-discussion, capture it as an issue without leaving the chat. Same for `/devloop:roadmap` when the direction shifts, for **`/devloop:docs`** when somebody new joins and needs to be brought up to speed, and for **`/devloop:architect`** when you hit a design question worth settling before code gets written — the one kind of decision that's most expensive to discover after the fact, and the one you least want to outsource. And because each of these skills works by *talking through* the decision with you — explaining trade-offs, asking what you want, showing you what it found — **the conversation itself is how you learn the system**, whether that conversation happens at a gate, at `review`, or mid-brainstorm. That's the study time that keeps the mental model yours.

---

## The tight loop — `/devloop:tinker`

Both workflows above are anchored to a **plan** — an issue, a sprint. There's one more mode that isn't: you at the keyboard with the app running, deciding what to build next by looking at it, and the AI writing the code on your behalf. It can be a one-line value or a whole feature — the size is yours to decide.

```
  inner loop   run --auto, sprint   AI executes, you're away      anchored to an issue
  outer loop   review               you judge what shipped        anchored to an issue or sprint
  tight loop   tinker          ←    you and the AI, app running   anchored to nothing but
                                    seconds per turn              the running system
```

`/devloop:tinker I want to refactor the sign-in page` opens a session, reads up on that part of the code, and waits for instructions. *Add a Sign in with Google button. Now make the sign-in button green. Commit.* You watch the UI, the logs, the database; it does the work, and keeps the project from drifting while it does.

**It isn't `run` with the tests turned off.** Every instruction gets the same question asked out loud — *does this change behaviour?* — and when it does, and an honest test exists, the test comes first and is checked to actually fail before any code is written. (A colour, a label or a value you're tuning by eye doesn't get a test that just restates it: you watching it is the proof. Same for something built to try out — it gets a check you run, not a suite — unless it touches data, money or who can see what.) You can overrule that in two seconds. Then the override is what gets written down: it lands in a short list of things running with nothing proving they work, which `review` offers back to you as issues at sprint close. That's the difference between **deferring** proof and skipping it.

A few other things it holds while you move fast:

- **Nothing commits until you say so.** Every change stops with a short summary, the files it touched and a proposed commit message. You read the change in your own editor, try it in the app, then say commit, retry or discard. If you edit the code yourself in between, it notices and re-runs the checks before committing.
- **One change, one commit** — or one commit per planned instruction. Not ceremony: after three changes and *"it's still wrong"*, it's the only thing that makes the undo precise.
- **Bigger instructions get planned, not refused.** When an instruction is several pieces, it plans it the way `run` does — tasks, where each piece of code goes in *your* repo, a design when there's a real choice to make, tests written first — and asks you before building only when the plan holds a decision that's yours (a new dependency, a new place for code, anything touching sign-in or permissions). It runs every check before showing you the result.
- **Small changes stay fast.** A colour or a label runs only the quick checks your profile has that can actually see that file — or none, if it has none. The rest wait for session close.
- **A session branch**, merged at the end only after every check passes, the diff is checked against your recorded decisions, and the whole session is reviewed. That's what stops a long session drifting from your architecture.
- **Decisions still bind.** An instruction that contradicts one of your ADRs gets the rule quoted back at you and a question, not a silent edit.

### What the project remembers

Every session leaves one line in the project journal:

```
- 2026-09-05 · tinker · hand-tuned · `src/ui/toast/**` · toast 2s→4s (you watched it, 2s too fast to read) → …
```

That line is why the value survives. Without it, the next agent to open that file sees a `4` where a `2` would look tidier — and tidying it up is the cheapest thing in the world. The journal is the project's memory **across** sessions: before every issue, the loop reads the entries touching the code it's about to change, so something you decided by hand while watching the app is still known about three sprints later.

---

## Docs for humans — `/devloop:docs`

Everything devloop records is written for the **next run**: the journal is a list of episodes, the decision records are case law, each issue keeps its own timeline. All useful, and none of it answers the question a person actually asks.

> *What is this system, right now?*

You can't get that by reading the history, because history is **additive** — you'd have to replay every episode and apply the changes in your head. The AI never notices, because it rebuilds exactly the slice it needs on every task and throws it away afterwards. **You can't.** So after six sprints the mental model you refreshed at each review has quietly drifted from the system you actually have, and a developer joining the team has nothing to join.

`/devloop:docs` writes the missing half — the documentation humans read. Architecture, onboarding, a development guide, a page per component. The **structure is reasoned from your system**, not poured into a template, and every claim carries the file it came from.

**And it keeps it honest.** Each page records the commit it was written against, so the skill can tell you exactly what has moved underneath it:

```
$ /devloop:docs

docs/backend/auth.md       ⚠ 9 commits under src/auth/** since this was written
                             incl. "replaced session store with JWT"
                             nobody has read this one
docs/backend/payments.md   ⚠ ADR-007 says only payments/ touches the database.
                             src/workers/sync.ts:31 imports the client directly.
src/notifications/**       ⚠ new since the last survey; no page covers it
docs/data/model.md         ok
```

The second finding is the interesting one. Nothing else in devloop asks whether a decision you recorded is **still true of the code** — the code review sees one change at a time, and the planning gate checks a plan before the code exists. This is the one place the standing rules get measured against the standing system.

Findings are **routed, never quietly resolved**: the page is wrong → refresh it. The code is wrong → file it. The rule is wrong → that's a conversation for `/devloop:architect`. It will not rewrite a page to agree with code that broke a decision you made.

Run it bare and it **audits** — cheap, writes nothing, safe at any time. On a project with no docs yet it surveys the repository and **proposes a tree for you to confirm** before writing a word. Small project, small tree: it won't pad out four files to look thorough, and it says so when the honest answer is two.

---

## The periodic physical — `/devloop:audit`

Every quality gate above is scoped to a **change**: the code review sees one diff, the PR review one PR, the test critic one test plan, the sprint review one sprint. Not one of them can see **accumulation** — because each issue added one reasonable abstraction, handled its own errors plausibly, exported one more symbol, and *no single diff was ever wrong*. Twenty issues later there are six layers nobody needs, five different things that happen when a request fails, and a test suite where a fifth of the tests could not fail if the product broke.

`/devloop:audit` is the only pass that reads your system in the **present tense**. It sweeps nine dimensions — design and YAGNI, coupling and cohesion, drift and code smells, test-suite integrity, security, resource and concurrency, failure architecture, data and state, and record-versus-reality — and prices what it finds.

Two things keep it from being a wall of opinions. **Every dimension is written as a sweep, not an adjective** — count the implementations of that interface, grep the callers of that export, tally which files keep changing together, list the handlers with no authorization check — and **every finding carries the sweep's result**, a `file:line`, one named fix, and what the fix costs. No result, no finding. "This violates SRP" is not something it is allowed to say; *"this file has been edited by issues from three unrelated epics, and here they are"* is.

That last one is the trick to auditing the things reviewers usually can't. SRP, cohesion and coupling are where code review turns into taste — so they are deliberately **out** of scope for the diff reviewer. A whole-system pass has what a diff reviewer lacks: the import graph, and your commit history. Against those, "tightly coupled" becomes *"these two files co-changed in 14 of the last 16 commits that touched either"*, and "one reason to change" becomes a count of the epics that keep touching a file.

The dimension most projects need most is **failure**. Nobody ever owns error handling: every issue handles its own, locally and sensibly, and the system ends up with several contradictory policies nobody chose. The audit reconstructs what actually happens to a failure at each layer, and where there is no rule to conform to, it says so — that finding is **`unowned`**, it cannot become a ticket, and it routes to `/devloop:architect` to be decided and recorded as an ADR. After which it is binding, and the ordinary code review enforces it on every diff. The audit doesn't just price the debt; it closes the gap that let it accumulate.

**It is read-only. There is no `--fix`.** It writes a report, walks the findings with you — blockers one at a time, the rest in bundles — and files what you approve as issues, so the work goes through `run` like everything else: planned, tested, reviewed. Two reasons it's built that way, and the second decides it on its own: it would be the one code path in devloop that skipped the whole loop, and a structural refactor is safe only because the test suite catches what it breaks — which is exactly the thing the audit just told you not to trust.

So the report's headline is not a score. It's a question:

```
Can you refactor behind this suite?    not yet — 23 of 310 tests cannot fail
```

And the remediation plan is ordered by it: **decide the unowned rules → restore the detector → remove the unsafe → simplify.** A sprint that schedules the refactor before the test repair has scheduled a bet.

**Run it on a cadence, not only when something feels wrong.** Every dimension it sweeps is exactly the kind of drift no other gate can see *while it's still cheap* — the whole reason it exists is that any one sprint's diffs look fine and the accumulation across several doesn't. A sensible rhythm is **once a sprint, at `/devloop:review`** (or every few, on a small or slow-moving project) — cheap enough to be routine, and its findings arrive through the same backlog triage as everything else, so keeping it current costs you one read of a table, not a special occasion.

---

## A third way in — `/devloop:vibe`

Everything above assumes you're a developer working in your own codebase. **`/devloop:vibe` is for the other case**: someone who wants a small app to exist, and isn't going to write it.

It is not the sprint loop with the tests switched off. It's a separate, lighter track that borrows the same agents:

```
  /devloop:vibe          ┌──────────────────────────────────────────┐
        │                │ 1. what are we building?  (a BA, not a   │
        ▼                │    technical interview — it drafts, you  │
   discovery ────────────┤    correct)                              │
        │                │ 2. the technical decisions — proposed,   │
        ▼                │    each with why, and whether it can be  │
   decisions ────────────┤    changed later. You get a veto.        │
        │                │ 3. a plan written as things you'll SEE   │
        ▼                └──────────────────────────────────────────┘
     plan
        │
        ▼
   ┌─► build to the next demo ──► "here's how to try it" ──► your feedback ─┐
   │            ▲                                                           │
   │            └── "change something first" ──► the plan changes           │
   │                                                                        │
   └────────────────── run /devloop:vibe again ◄────────────────────────────┘
                                    │
                                    ▼
                      harden — real tests + a security pass,
                      before anyone else can use it
```

**No flags, ever.** Run `/devloop:vibe` and it picks up wherever you left off. If you want something
else, just say it after the command — `/devloop:vibe I want to add a screen for the monthly report`, in
whatever language you speak. That is read as what you meant, not parsed as an option, and it never
starts building anything: it opens a conversation.

**What makes it different from just asking an AI to build you an app:**

- **The plan is a list of things you'll see running**, not a list of tasks you'd have to pretend to understand. *"You can add a task" → "your tasks are still there after you close the browser" → "only you can see yours."* You approve an order you can actually judge.
- **You run the demo, not the AI.** Every step ends with a recipe — exact commands, real values, what you should see **and what wrong looks like** — and then it asks what you saw. An AI reporting "✓ it works" is a self-report; it's not evidence, and it's not how you end up trusting your own app.
- **Every technical decision comes with whether it can be undone.** Nobody tells non-technical people this, and it's the single most useful thing to know: it's what tells you which choices are worth arguing about.
- **Your feedback gets classified out loud** — a *fix*, a *follow-up*, or a *new idea that isn't in what we agreed to build*. That last one is why small projects never finish, and it's invisible unless someone names it.
- **Every demo is a tag you can go back to.** "I don't like this" is a supported operation.
- **The plan is not a contract you signed at the start.** You change your mind *because* you've seen it running — that's the whole point of building it this way — so changing the plan is as ordinary as giving feedback. Every milestone starts by telling you what's coming and waiting (*"go / change something first"*), and you can say so at any other moment too. What's already built and running stays built: if you want it gone, that's a real change you get told about, not a quiet edit to the plan that pretends it never happened.
- **It remembers which language to talk in.** You can be talked to in Vietnamese while the code is written in English, or have both in Vietnamese — two separate settings, decided once and kept across sessions, so it doesn't quietly switch back the next time you open it. When the two differ, the words *you* use for things get one recorded translation into the code, so the same thing isn't called three different names in three different places. And you're told which parts of a technical decision can be undone later — the language inside the code is one of the ones that can't, easily.
- **No TDD, but not "no tests".** Each step records what still needs proving; before the app is shared with anyone, that ledger is harvested into real unit, integration and e2e tests — written from the demo recipes, so the suite proves what you were actually shown. A deploy with an unproven ledger is refused.
- **Secrets are scanned on every single commit.** A leaked key is the one mistake you can't undo later, so it's checked mechanically every time rather than at review.
- **Demo data stays out of the app.** The demo needs something to show, and with no test suite yet the easy place to put it is the shipped code. So the preference is that *you* type the data in through the app itself; when that isn't possible it lives in its own directory with its own command, and the boundary is checked before every commit. Anything faked outright — a sign-in that doesn't check a password — is listed, said out loud at the demo, and replaced before you can share it.

Greenfield projects, git required (it's the undo button), no GitHub needed. When it outgrows itself — more than six milestones, or you start wanting proper reviews and staged releases — it says so and hands you to the full loop, keeping everything already built.

---

## Install

devloop is a Claude Code plugin (not an npm package). Install it from your plugin marketplace or point Claude Code at the plugin directory.

**Try it locally:**

```bash
claude --plugin-dir ./devloop
```

**Reload after edits (no restart needed):**

```
/reload-plugins
```

Once active, all skills are available under the `/devloop:` namespace (e.g. `/devloop:plan`).

### MCP servers (bundled)

devloop talks to GitHub through **two MCP servers, both declared in the plugin's `.mcp.json`** and started automatically when the plugin is active. You don't configure either one by hand:

| Server | Provides | How it's wired |
|---|---|---|
| **`github`** (official GitHub MCP) | Issues, PRs, branches, adding labels to issues | Remote server at `https://api.githubcopilot.com/mcp/`, authenticated with `Authorization: Bearer ${GITHUB_TOKEN}`. |
| **`github-extras`** (bundled) | Create / assign / **clear** / close GitHub **milestones**, plus **list / create repository labels** — the operations the official server doesn't cover | Local stdio server (`bin/github-extras.js`), launched via `${CLAUDE_PLUGIN_ROOT}`. Reads the same `GITHUB_TOKEN`. |

> **The only thing you must provide is `GITHUB_TOKEN`** — a GitHub Personal Access Token with repo access, exported in your environment before launching Claude Code.
>
> ```bash
> export GITHUB_TOKEN=ghp_your_token_here
> ```

---

## Skills

Skills are what you invoke. The conversational ones pause at every human gate; the autonomous ones (`run --auto`, `sprint`) run unblocked and log every decision for later review.

### Set up the project

| Skill | What it's for |
|---|---|
| **`/devloop:roadmap [topic]`** | Initialize or update the project **master plan** (vision, sprint themes, goals) from your conversation. Also bootstraps the **project profile** (`.context/devloop-profile.md`) — the build/test commands `plan` and `run` rely on. Run this first on a new project. |
| **`/devloop:backlog [topic]`** | Distill a brainstorm into GitHub **backlog issues** (`type:backlog`). Proposes candidates, you confirm/edit, it creates the approved ones. |

### Build something small *(a separate, lighter track)*

| Skill | What it's for |
|---|---|
| **`/devloop:vibe`** | Build a **small app with someone who isn't a developer**. Starts with a business-analyst conversation to find out what they actually want, proposes each technical decision with its reasoning and **whether it can be undone later**, then plans the work as a **sequence of things they'll get to see running**. Each invocation builds up to the next demo and hands over a recipe to try it; feedback becomes a patch, a follow-up, or a deliberate change of scope. **The plan can be changed whenever they say so** — every milestone starts by asking, and shipped work is never quietly edited out of it. **Remembers which language to talk in and which to write code in**, across sessions. No TDD — what's unproven is tracked and harvested into real tests before the app is shared. Secrets scanned every commit. **No flags**: run it bare to carry on, or just say what you want. Greenfield, no GitHub. |

### Plan & steer *(outer loop — slow)*

| Skill | What it's for |
|---|---|
| **`/devloop:architect [topic \| path \| issue]`** | Talk a **design decision** through with a senior architect — should this be split, where does it belong, is this over-engineered or overdue. It gives one concrete verdict (not a menu), checks your claims against git history and the callers rather than taking them on faith, and treats "leave it alone" as a real answer — recorded with the trigger that would reopen it. Settled decisions become **ADRs** in `.context/decisions/`, which later runs then treat as binding. |
| **`/devloop:plan`** | Scope a sprint. Sets the goal and end-of-sprint demo, triages backlog issues, selects sprint-ready ones, ensures each has acceptance criteria its own change can satisfy (checked against the execution order) and a Definition of Done, creates a GitHub **milestone**, sets execution order, and writes the sprint file. |
| **`/devloop:replan`** | Amend the **active** sprint mid-flight — **add** an issue, **drop** one, **reorder**, **re-scope/split**, or file **rework** for shipped work as a new issue cross-linked to the original. The transactional sibling of `plan`; both share one spec so amendments stay format-identical. Usually invoked for you from `review`. |

### Execute *(inner loop — fast, or gated)*

| Skill | What it's for |
|---|---|
| **`/devloop:run [issue] [--auto] [--pr]`** | The execution engine — one issue from ticket to merged code: context → plan → TDD → review → merge. A **resumable** state machine; re-invoke to continue from the last completed phase — and re-invoking an `--auto` run *without* the flag resumes it gated, which is how you answer whatever made it halt. **Default:** human-in-the-loop, pausing at each gate, merging locally with no PR. **`--auto`:** human-on-the-loop — no gates, decisions logged, runs to completion (merges); review happens afterward in `/devloop:review`. **`--pr`:** deliver through a GitHub PR instead of a local merge (human mode then halts at the open PR for review; auto mode merges it through). |
| **`/devloop:sprint`** | Execute the **whole** active sprint autonomously. A thin orchestrator over `run --auto` that works every issue in order, merging each locally as it lands (**PR-less**), and **stops the moment it hits a blocker it can't resolve** (never skipping ahead). Hands off to `review` when done. Re-invoke to resume after an interruption. |
| **`/devloop:status [sprint-N]`** | Read-only snapshot — issue statuses, the in-progress step, milestone progress, and which shipped issues are **accepted vs. awaiting review**. No gates, no changes. |
| **`/devloop:abort [issue]`** | The escape hatch for `run`. Cleanly stops an in-progress run: releases the lock, hands you the branch (delete / keep / park as draft PR) and run state (delete or keep to resume). Doesn't close the issue or touch the milestone. |
| **`/devloop:tinker [goal]`** | The **tight loop** — you and the AI at the keyboard with the app running, one instruction at a time, from a one-line tweak to a whole feature. Give it a goal (`/devloop:tinker I want to refactor the sign-in page`) and it reads up on that area first. Small changes are applied directly with only the quick checks that can see them; bigger ones are **planned the way `run` plans them** and built test-first with every check, stopping to ask only when the plan holds a decision that's yours. Every change then stops with a short summary, the files touched and a proposed commit message — you review it in your editor, try it in the app, and it commits **only when you say so**. Works on a session branch, merged at close only after every check passes, the diff is checked against your recorded decisions, and the whole session is reviewed. Every session leaves a line in the project journal, so the next sprint knows why that value is 4 seconds and not 2. Runs in both tracks. |

### Understand & onboard *(any time)*

| Skill | What it's for |
|---|---|
| **`/devloop:docs [path]`** | Write and maintain the documentation **humans** read — architecture, onboarding, development guide, a page per component. Structure is reasoned from your actual system rather than a template, and every claim cites the file it came from. Run it **bare to audit**: each page records the commit it was written against, so it reports what the code has moved out from under, what nothing covers, and where the code no longer obeys a decision you recorded. Findings are routed (refresh the page / file the bug / take the rule to `architect`), never silently patched over. Nothing is written or committed without your yes. |
| **`/devloop:audit [path]`** | Audit the **whole system as it stands**, not a diff — the thing no per-change review can see. Nine dimensions: design and YAGNI, coupling and cohesion (measured from your import graph and commit history, including SRP counted from the epics that keep touching a file), drift and code smells, **test-suite integrity** (tests that cannot fail, tests that only assert their own mocks, tests of the demo), security **including leaked credentials** (tracked `.env` files, keys still in history — rotate first, delete second), resource and concurrency, **failure architecture** (one policy or five, handled where it can be decided, context preserved, retries not stacked, error paths actually tested), data and state, and record-versus-reality (stubs shipped as finished, closed acceptance criteria with no live code path). Every finding carries the sweep result that proves it, a `file:line`, one named fix and a cost — no result, no finding. **Read-only**: it reports, walks the findings with you, and files the work as issues; it never edits code and never takes the lock. Best run **on a cadence** (once a sprint is a sane default) rather than only when something already feels off — that's what keeps drift priced before it's expensive to unwind. |

### Review & close *(outer loop — slow)*

| Skill | What it's for |
|---|---|
| **`/devloop:review [issue \| sprint-N]`** | The review conversation, at two scopes. **`review 42`** — *task* review: the AI explains what it built and why, you demo and question it, then **accept** (merging its PR if still open) or request **rework** (a new linked issue via `replan`). **`review`** — *sprint* review: walk every not-yet-accepted task the same way, then reconcile remaining issues, write the retrospective, **tag the release**, and **close the milestone**. |
| **`/devloop:pr-review [repo#prN]`** | Code-level PR review. Reviews a PR like a senior dev and submits curated findings as **one inline GitHub review**. Read-only on your tree; posts only what you approve. (Complements `review`, which is product-level — "is this the right thing?" vs. "is the code sound?") |
| **`/devloop:pr-fix [repo#prN]`** | Address review comments end-to-end: checks out the branch, triages comments with you, applies each fix with test verification, runs a scoped fix-review, then — after a final gate — **pushes and replies** to the threads. |

---

## Agents

Agents are the workers behind the skills — you don't invoke them directly. Each owns a narrow role and reports back to the orchestrating skill, which owns all human interaction.

| Agent | Role |
|---|---|
| **backlog-triage** | Fetches `type:backlog` issues and classifies each against the sprint goal. Used by `plan`. |
| **issue-selector** | Fetches sprint-ready issues (no milestone, not backlog) and suggests include/consider/skip. Used by `plan`, `replan`. |
| **context** | Assembles the central knowledge file (`context.md`) from issues, docs, and codebase patterns. Issue-anchored for `run`, diff-anchored in PR mode. **Sizes retrieval depth to the issue** (light by default) and **deepens a specific gap on demand** when a later agent asks for more. |
| **planner** | Turns context (and an approved design) into an ordered task list (`plan.md`) and a test strategy (`test-plan.md`), and **sizes the process to the task** via a rung (STANDARD / REFACTOR / EXPRESS / TRIVIAL). The test strategy starts from **what the work is for** — reasoned from your issue, labels and sprint demo, not a keyword list — and gives each behaviour a proof: a test with its edge cases, a check you run by eye, or none with a reason. A demo gets a demo's proof; a permission rule gets tested whatever it is for. Used by `run`, and by `tinker` for its bigger instructions. Can raise `NEEDS-CONTEXT`, `NEEDS-DESIGN`, or `MANUAL`. |
| **test-critic** | A fresh read of the drafted **test plan**, in both directions: the edge, error and permission cases it misses, and the filler it should cut — a test that restates a value, re-checks a library, or pins what your eyes judge better. The planner revises once; what changed, and anything it kept against the critic, is shown to you at the plan gate. |
| **designer** | Design/architecture specialist. Authors an implementation guide (`design.md`); a fresh instance critiques it against named criteria. Designs **within** your recorded architecture decisions — if an issue can't be built without breaking one, it stops and says so rather than quietly designing around it. Overturning a decision you made is your call, in `/devloop:architect`, not a side effect of a run. |
| **test-writer** | Writes the specified **failing** tests (unit + E2E) — from the test plan, or from a scenario handed to it directly when there is no plan (a single `tinker` change, which may also update an existing test) — or a **regression** test reproducing a bug before it's fixed. Never runs them, never writes production code. When a clean test is impossible without an unsafe cast, it **stops** — that's the production interface being too narrow, not a test that needs a hack. |
| **coder** | Implements one task to make its failing tests pass, runs the project's checks, commits only when green (*green* = no **new** failures). For a trivial or behavior-preserving change it applies the change **without a test-first step** (the checks still gate it), and in `vibe` mode builds new behavior the same way, with proof deferred to that track's hardening pass. Also runs throwaway spikes. Its green is provisional — the test-runner has the last word. |
| **test-runner** | The **independent verifier** — it didn't write the code, and it can't edit it. Runs tests and classifies every failure as **new / accepted / pre-existing** (using the baseline allowlist). Also verifies the **red** step: that a fresh test really fails, and fails for the right reason, rather than erroring on a broken import or passing vacuously. |
| **ba-critic** | Reads a drafted **product brief** and reports what a non-technical owner could read, be wrong about, and not notice — a capability nobody could fail, a domain word doing real work but never defined, a missing "what it does NOT do" list. Returns the plain question that settles each. The check on a comfortable conversation producing a comfortable, wrong brief. |
| **pr-triage** | Classifies a PR's review intensity (light/full) from the nature of the diff. Used by `pr-review`. |
| **reviewer** | Reviews a diff and surfaces concrete `file:line` findings. Modes: review / pr-review / critique / fix-review. Carries a **test-pass-insufficient** rubric for the bug class a green suite can't rule out (concurrency, resource scoping, ordering, idempotency, reversibility) — those are argued from the code, and "the tests pass" is not a rebuttal. Reasons only — never posts to GitHub. |
| **auditor** | Sweeps the **whole codebase** for one group of audit dimensions and returns findings in a fixed grammar — claim, `file:line`, the sweep result that proves it, one named fix, a cost. Modes: structure / drift / tests / security / runtime / data, plus a **critique** pass that upholds, drops, and merges duplicates across dimensions. Read-only: it never writes a file, and never runs your build or your suite — a pass that ran the tests could touch a real database, and six of them would do it six times. Used by `audit`. |
| **surveyor** | Reads the codebase and reports what is actually there — entry points, the real components, what owns which data, which way the dependencies point, what changes every sprint. Cites what it finds and never invents a path. Used by `docs`. |
| **doc-writer** | Writes one page of the documentation tree from that survey and the architecture page. It has **no shell access**, so it can't commit — you see the real diff first and the skill commits. |
| **doc-critic** | Reads a drafted page as the developer it was written for, and reports where they'd still be stuck: a claim with no source, a term used before it's explained, a wall of prose, a hedge. A fresh reader every time, which is the whole point. |
| **scaffolder** | Creates the repo (if needed) and bootstraps project structure, build tooling, and test setup, committing to the base branch. |

---

## What devloop writes to your repo

devloop keeps its state under `.context/` so work resumes across sessions:

| Path | Role | Purpose |
|---|---|---|
| `.context/product-brief.md` | shared record | What the product **is**, in the owner's words — the domain terms as they use them, who actually uses it, one day in the life, and **what it does not do**. Deliberately free of technology, and written in their language, so it stays their document: it's confirmed by them correcting it, which only works if they can read it. Written by `vibe` and `roadmap`. |
| `.context/devloop-profile.md` | shared record | Build/test commands and test layout. The single source `run` uses — it never guesses a command. |
| `.context/devloop-baseline.md` | shared record | Accepted-failure allowlist — checks known to fail, so the green gate means "no *new* failures." |
| `.context/devloop-journal.md` | shared record | **The project's memory across sessions** — one line per finished piece of work, in any mode: what changed, in which areas, and **why**. Read by the loop before every issue, so a value you tuned by hand while watching the app is still known about three sprints later. Append-only, and never rewritten — history that gets edited isn't evidence. |
| `.context/devloop-unproven.md` | shared record | Behaviour that shipped **without a test because you said "not now"** — what it does, and what would prove it. Offered back as issues at sprint close and as candidates when the next sprint is scoped, so *we'll test it later* doesn't quietly become *we never did*. |
| `.context/audits/` | shared record | One report per `/devloop:audit`, kept rather than overwritten — what the system had accumulated on that date, priced, with the sweep result behind every finding. History is what lets the next audit say whether the debt is actually falling, and which findings you already closed. |
| `.context/devloop-audit-accepted.md` | shared record | Audit findings you looked at and **chose to live with** — each with the reason and a `reopen when:` condition. Without it every audit re-raises the same forty things and you learn to stop reading them; with it, a settled trade-off stays settled until the thing that would change it happens. |
| `.context/decisions/` | shared record | Architecture decision records from `/devloop:architect`, plus an `index.md` the loop scans to find the ones bearing on a task. Append-only: a changed decision is a new record superseding the old, so the reasoning you can go back and read is the reasoning that was actually used. |
| `.context/sprints/master-plan.md` | shared record | Project sprint map: vision, themes, goals, statuses. |
| `.context/sprints/sprint-N.md` | shared record | Per-sprint execution checklist. Each issue line tracks execution (`[x]`, by `run`) and human acceptance (`✓accepted`, by `review`) separately. |
| `.context/sprints/sprint-N-review.md` | shared record | Sprint retrospective — including **loop calibration**: which of devloop's own gates caught the sprint's defects, and which never fired. |
| `.context/vibe/` | `vibe` track | The whole state of a `vibe` project in one readable file — goal, which language to talk and write in, the technical decisions with their reasoning and reversibility, the demo-shaped plan with its tags and a marker for where the work has got to, what hasn't been proved yet, what's been parked, and every plan change with the reason for it. Written in the owner's language throughout: a state file they can't read isn't doing its job. |
| `docs/` (or wherever you put it) | shared record | **The documentation humans read** — architecture, onboarding, development guide, per-component pages. Plain prose and diagrams, with no devloop bookkeeping in them: it's a document tree, not a machine file. Version-controlled, for whoever clones the repo. |
| `.context/docs-map.md` | shared record | Which pages exist, what code each one covers, who each is for, and **the commit each was written against** — which is what turns "have the docs gone stale?" into a question with a real answer. The last drift report sits beside it in `docs-audit.md`, and `plan` reads it when scoping the next sprint. |
| `.context/sprints/state/` | working area | Lock + per-issue control plane (lets `run`/`sprint` resume). |
| `.context/sprints/work/` | working area | Per-issue working files (`context.md` with its logged decision timeline, `plan.md`, `test-plan.md`, …) plus `logs/` — the raw test output behind each logged failure, kept out of the timeline and opened on demand at review. |
| `.context/tinker/` | working area | One folder per `tinker` session — the goal, what it looked up about the area you were working in, the plan for any bigger instruction, and one entry per commit: what changed, **why**, how it was proved, and the SHA. |

Whether any of `.context/` is version-controlled is your choice.

---

## License

[MIT](LICENSE)
