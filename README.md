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

That log records more than decisions. For every bug the run hit, it records **which gate caught it** — a failing test, the type checker, the code review, the second-opinion pass — and keeps the raw failing output on disk. So at review you can ask *"how did you catch this?"* and get an answer with the evidence attached, rather than a plausible story. It also means the loop can tell you, over a sprint, **which of its own checks are actually earning their keep** and which have never once caught anything.

---

## Two workflows

Both workflows share the same setup and the same close — they differ in **where you sit relative to the fast execution**, which is exactly what "in the loop" and "on the loop" mean. The default is in-the-loop; you opt into on-the-loop with `--auto` (per task) or `/devloop:sprint` (per sprint).

The diagrams below show the two ends of that spectrum — full control at every gate, and full autonomy across a whole sprint. They're illustrations, not the only shapes available; see [Mix and match](#mix-and-match-these-are-primitives-not-pipelines) below for how to run something in between.

### 🧑‍💻 Human-*in*-the-loop — you ride every step

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

### 🛰️ Human-*on*-the-loop — you watch from above

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

The conversational skills aren't locked to any diagram either. **`/devloop:backlog` can be dropped into any conversation, any time** — the moment an idea or a bug surfaces mid-discussion, capture it as an issue without leaving the chat. Same for `/devloop:roadmap` when the direction shifts, and for **`/devloop:architect`** when you hit a design question worth settling before code gets written — the one kind of decision that's most expensive to discover after the fact, and the one you least want to outsource. And because each of these skills works by *talking through* the decision with you — explaining trade-offs, asking what you want, showing you what it found — **the conversation itself is how you learn the system**, whether that conversation happens at a gate, at `review`, or mid-brainstorm. That's the study time that keeps the mental model yours.

---

## A third way in — `/devloop:vibe`

Everything above assumes you're a developer with a repo, issues and a sprint. **`/devloop:vibe` is for the other case**: someone who wants a small app to exist, and isn't going to write it.

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
| **`/devloop:plan`** | Scope a sprint. Sets the goal and end-of-sprint demo, triages backlog issues, selects sprint-ready ones, ensures each has acceptance criteria and a Definition of Done, creates a GitHub **milestone**, sets execution order, and writes the sprint file. |
| **`/devloop:replan`** | Amend the **active** sprint mid-flight — **add** an issue, **drop** one, **reorder**, **re-scope/split**, or file **rework** for shipped work as a new issue cross-linked to the original. The transactional sibling of `plan`; both share one spec so amendments stay format-identical. Usually invoked for you from `review`. |

### Execute *(inner loop — fast, or gated)*

| Skill | What it's for |
|---|---|
| **`/devloop:run [issue] [--auto] [--pr]`** | The execution engine — one issue from ticket to merged code: context → plan → TDD → review → merge. A **resumable** state machine; re-invoke to continue from the last completed phase — and re-invoking an `--auto` run *without* the flag resumes it gated, which is how you answer whatever made it halt. **Default:** human-in-the-loop, pausing at each gate, merging locally with no PR. **`--auto`:** human-on-the-loop — no gates, decisions logged, runs to completion (merges); review happens afterward in `/devloop:review`. **`--pr`:** deliver through a GitHub PR instead of a local merge (human mode then halts at the open PR for review; auto mode merges it through). |
| **`/devloop:sprint`** | Execute the **whole** active sprint autonomously. A thin orchestrator over `run --auto` that works every issue in order, merging each locally as it lands (**PR-less**), and **stops the moment it hits a blocker it can't resolve** (never skipping ahead). Hands off to `review` when done. Re-invoke to resume after an interruption. |
| **`/devloop:status [sprint-N]`** | Read-only snapshot — issue statuses, the in-progress step, milestone progress, and which shipped issues are **accepted vs. awaiting review**. No gates, no changes. |
| **`/devloop:abort [issue]`** | The escape hatch for `run`. Cleanly stops an in-progress run: releases the lock, hands you the branch (delete / keep / park as draft PR) and run state (delete or keep to resume). Doesn't close the issue or touch the milestone. |

### Review & close *(outer loop — slow)*

| Skill | What it's for |
|---|---|
| **`/devloop:review [issue \| sprint-N]`** | The review conversation, at two scopes. **`review 42`** — *task* review: the AI explains what it built and why, you demo and question it, then **accept** (merging its PR if still open) or request **rework** (a new linked issue via `replan`). **`review`** — *sprint* review: walk every not-yet-accepted task the same way, then reconcile remaining issues, write the retrospective, **tag the release**, and **close the milestone**. |
| **`/devloop:pr-review [repo#prN]`** | Code-level PR review. Reviews a PR like a senior dev and submits curated findings as **one inline GitHub review**. Read-only on your tree; posts only what you approve. (Complements `review`, which is product-level — "is this the right thing?" vs. "is the code sound?") |
| **`/devloop:pr-fix [repo#prN]`** | Address review comments end-to-end: checks out the branch, triages comments with you, applies each fix with test verification, runs a scoped fix-review, then — after a final gate — **pushes and replies** to the threads. |

---

## Agents

Agents are the workers behind the skills — you don't invoke them directly. Each owns a narrow role and reports back to the orchestrating skill, which owns all human interaction.

| Agent | Model | Role |
|---|---|---|
| **backlog-triage** | haiku | Fetches `type:backlog` issues and classifies each against the sprint goal. Used by `plan`. |
| **issue-selector** | haiku | Fetches sprint-ready issues (no milestone, not backlog) and suggests include/consider/skip. Used by `plan`, `replan`. |
| **context** | sonnet | Assembles the central knowledge file (`context.md`) from issues, docs, and codebase patterns. Issue-anchored for `run`, diff-anchored in PR mode. **Sizes retrieval depth to the issue** (light by default) and **deepens a specific gap on demand** when a later agent asks for more. |
| **planner** | sonnet | Turns context (and an approved design) into an ordered task list (`plan.md`) and a test strategy (`test-plan.md`), and **sizes the process to the task** via a rung (EXPRESS / STANDARD / REFACTOR). Can raise `NEEDS-CONTEXT`, `NEEDS-DESIGN`, or `MANUAL`. |
| **designer** | sonnet | Design/architecture specialist. Authors an implementation guide (`design.md`); a fresh instance critiques it against named criteria. Designs **within** your recorded architecture decisions — if an issue can't be built without breaking one, it stops and says so rather than quietly designing around it. Overturning a decision you made is your call, in `/devloop:architect`, not a side effect of a run. |
| **test-writer** | sonnet | Writes the specified **failing** tests (unit + E2E), or a **regression** test reproducing a bug before it's fixed. Never runs them, never writes production code. When a clean test is impossible without an unsafe cast, it **stops** — that's the production interface being too narrow, not a test that needs a hack. |
| **coder** | sonnet | Implements one task to make its failing tests pass, runs the project's checks, commits only when green (*green* = no **new** failures). For a trivial or behavior-preserving change it applies the change **without a test-first step** (the checks still gate it), and in `vibe` mode builds new behavior the same way, with proof deferred to that track's hardening pass. Also runs throwaway spikes. Its green is provisional — the test-runner has the last word. |
| **test-runner** | sonnet | The **independent verifier** — it didn't write the code, and it can't edit it. Runs tests and classifies every failure as **new / accepted / pre-existing** (using the baseline allowlist). Also verifies the **red** step: that a fresh test really fails, and fails for the right reason, rather than erroring on a broken import or passing vacuously. |
| **ba-critic** | sonnet | Reads a drafted **product brief** and reports what a non-technical owner could read, be wrong about, and not notice — a capability nobody could fail, a domain word doing real work but never defined, a missing "what it does NOT do" list. Returns the plain question that settles each. The check on a comfortable conversation producing a comfortable, wrong brief. |
| **pr-triage** | haiku | Classifies a PR's review intensity (light/full) from the nature of the diff. Used by `pr-review`. |
| **reviewer** | sonnet | Reviews a diff and surfaces concrete `file:line` findings. Modes: review / pr-review / critique / fix-review. Carries a **test-pass-insufficient** rubric for the bug class a green suite can't rule out (concurrency, resource scoping, ordering, idempotency, reversibility) — those are argued from the code, and "the tests pass" is not a rebuttal. Reasons only — never posts to GitHub. |
| **scaffolder** | sonnet | Creates the repo (if needed) and bootstraps project structure, build tooling, and test setup, committing to the base branch. |

---

## What devloop writes to your repo

devloop keeps its state under `.context/` so work resumes across sessions:

| Path | Role | Purpose |
|---|---|---|
| `.context/product-brief.md` | shared record | What the product **is**, in the owner's words — the domain terms as they use them, who actually uses it, one day in the life, and **what it does not do**. Deliberately free of technology, and written in their language, so it stays their document: it's confirmed by them correcting it, which only works if they can read it. Written by `vibe` and `roadmap`. |
| `.context/devloop-profile.md` | shared record | Build/test commands and test layout. The single source `run` uses — it never guesses a command. |
| `.context/devloop-baseline.md` | shared record | Accepted-failure allowlist — checks known to fail, so the green gate means "no *new* failures." |
| `.context/decisions/` | shared record | Architecture decision records from `/devloop:architect`, plus an `index.md` the loop scans to find the ones bearing on a task. Append-only: a changed decision is a new record superseding the old, so the reasoning you can go back and read is the reasoning that was actually used. |
| `.context/sprints/master-plan.md` | shared record | Project sprint map: vision, themes, goals, statuses. |
| `.context/sprints/sprint-N.md` | shared record | Per-sprint execution checklist. Each issue line tracks execution (`[x]`, by `run`) and human acceptance (`✓accepted`, by `review`) separately. |
| `.context/sprints/sprint-N-review.md` | shared record | Sprint retrospective — including **loop calibration**: which of devloop's own gates caught the sprint's defects, and which never fired. |
| `.context/vibe/` | `vibe` track | The whole state of a `vibe` project in one readable file — goal, which language to talk and write in, the technical decisions with their reasoning and reversibility, the demo-shaped plan with its tags and a marker for where the work has got to, what hasn't been proved yet, what's been parked, and every plan change with the reason for it. Written in the owner's language throughout: a state file they can't read isn't doing its job. |
| `.context/sprints/state/` | working area | Lock + per-issue control plane (lets `run`/`sprint` resume). |
| `.context/sprints/work/` | working area | Per-issue working files (`context.md` with its logged decision timeline, `plan.md`, `test-plan.md`, …) plus `logs/` — the raw test output behind each logged failure, kept out of the timeline and opened on demand at review. |

Whether any of `.context/` is version-controlled is your choice.

---

## License

[MIT](LICENSE)
