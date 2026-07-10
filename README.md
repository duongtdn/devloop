# devloop

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Claude Code plugin that runs a full **sprint lifecycle** — plan, execute, review, close — from inside Claude Code, on top of your GitHub issues and milestones. Specialized sub-agents do the work; you decide how much of the driving to keep.

Devloop's north star isn't "let the AI build it for you." It's **move fast *without outsourcing your understanding* of your own software.**

---

## The idea of Fast and Slow

AI can now write software faster than a human can follow it. The tempting move is to hand over the wheel completely. But if you outsource the *doing*, you quietly outsource the *understanding* too — and you end up the owner of a codebase you can't reason about. That debt compounds: every next decision is harder because you no longer hold the mental model.

Devloop's bet is that you can keep **both** — AI's speed *and* your grip on the system — if you're deliberate about **where the human spends attention.** So it runs at two speeds:

- **Fast** — let the AI run unblocked. This is where velocity comes from: it plans, writes tests, implements, reviews its own diff, opens (and can merge) PRs, all without stopping to ask.
- **Slow** — sit down *with* the AI and review, question, demo, and adjust. This is where **you build and refresh your mental model.** It's a conversation and a study session, not a rubber stamp.

The slow part never disappears — it just moves depending on how you work. And because everything the AI does on the fast path is **logged with its reasoning**, the slow review is genuine understanding, not archaeology. You come out the other side having shipped quickly *and* knowing what you shipped and why.

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

`/devloop:sprint` (and `/devloop:run --auto`) **run without stopping** — at every point that would be a gate, the AI reasons to the best decision, applies it, and **logs it with the reasoning**. If it can't decide something safely (a stuck task, a conflict, work needing a human hand), it halts and tells you rather than guessing. You meet the finished work at `/devloop:review`: it explains what it built and why, you demo and probe it, then **accept** or send it back as **rework**.

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
  /devloop:run 42 --auto     one issue, no gates, halts at the open PR
        │
        ▼
  /devloop:review 42         demo and question just that task → accept or rework
        │
        ▼
  /devloop:run 43 --auto     repeat, issue by issue
```

That's on-the-loop working at **task granularity** — a tighter feedback loop than `/devloop:sprint`, with a smaller, fresher batch to review each time, and still no gates slowing execution down. You can go further still and mix the two workflows within one sprint: gate the one issue you're unsure about with plain `/devloop:run`, and `--auto` the rest.

The conversational skills aren't locked to any diagram either. **`/devloop:backlog` can be dropped into any conversation, any time** — the moment an idea or a bug surfaces mid-discussion, capture it as an issue without leaving the chat. Same for `/devloop:roadmap` when the direction shifts. And because each of these skills works by *talking through* the decision with you — explaining trade-offs, asking what you want, showing you what it found — **the conversation itself is how you learn the system**, whether that conversation happens at a gate, at `review`, or mid-brainstorm. That's the study time that keeps the mental model yours.

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
| **`github-extras`** (bundled) | Create / assign / close GitHub **milestones**, plus **list / create repository labels** — the operations the official server doesn't cover | Local stdio server (`bin/github-extras.js`), launched via `${CLAUDE_PLUGIN_ROOT}`. Reads the same `GITHUB_TOKEN`. |

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

### Plan & steer *(outer loop — slow)*

| Skill | What it's for |
|---|---|
| **`/devloop:plan`** | Scope a sprint. Sets the goal and end-of-sprint demo, triages backlog issues, selects sprint-ready ones, ensures each has acceptance criteria and a Definition of Done, creates a GitHub **milestone**, sets execution order, and writes the sprint file. |
| **`/devloop:replan`** | Amend the **active** sprint mid-flight — **add** an issue, **drop** one, **reorder**, **re-scope/split**, or file **rework** for shipped work as a new issue cross-linked to the original. The transactional sibling of `plan`; both share one spec so amendments stay format-identical. Usually invoked for you from `review`. |

### Execute *(inner loop — fast, or gated)*

| Skill | What it's for |
|---|---|
| **`/devloop:run [issue] [--auto [--merge]]`** | The execution engine — one issue from ticket to PR: context → plan → TDD → review → PR. A **resumable** state machine; re-invoke to continue from the last completed phase. **Default:** human-in-the-loop, pausing at each gate. **`--auto`:** human-on-the-loop — no gates, decisions logged, halts at the open PR. **`--auto --merge`:** also merges (used by `sprint`). |
| **`/devloop:sprint`** | Execute the **whole** active sprint autonomously. A thin orchestrator over `run --auto --merge` that works every issue in order, merging each as it lands, and **stops the moment it hits a blocker it can't resolve** (never skipping ahead). Hands off to `review` when done. Re-invoke to resume after an interruption. |
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
| **context** | sonnet | Assembles the central knowledge file (`context.md`) from issues, docs, and codebase patterns. Issue-anchored for `run`, diff-anchored in PR mode. |
| **planner** | sonnet | Turns context (and an approved design) into an ordered task list (`plan.md`) and a test strategy (`test-plan.md`). Can raise `NEEDS-DESIGN` or `MANUAL`. |
| **designer** | sonnet | Design/architecture specialist. Authors an implementation guide (`design.md`); a fresh instance critiques it against named criteria. |
| **test-writer** | sonnet | Reads `test-plan.md` and writes the specified **failing** tests (unit + E2E). Never writes production code. |
| **coder** | sonnet | Implements one task to make its failing tests pass, runs the project's checks, commits only when green. Also runs throwaway spikes. |
| **test-runner** | sonnet | Runs tests and classifies every failure as **new / accepted / pre-existing** (using the baseline allowlist). Never edits code. |
| **pr-triage** | haiku | Classifies a PR's review intensity (light/full) from the nature of the diff. Used by `pr-review`. |
| **reviewer** | sonnet | Reviews a diff and surfaces concrete `file:line` findings. Modes: review / pr-review / critique / fix-review. Reasons only — never posts to GitHub. |
| **scaffolder** | sonnet | Creates the repo (if needed) and bootstraps project structure, build tooling, and test setup, committing to the base branch. |

---

## What devloop writes to your repo

devloop keeps its state under `.context/` so work resumes across sessions:

| Path | Role | Purpose |
|---|---|---|
| `.context/devloop-profile.md` | shared record | Build/test commands and test layout. The single source `run` uses — it never guesses a command. |
| `.context/devloop-baseline.md` | shared record | Accepted-failure allowlist — checks known to fail, so the green gate means "no *new* failures." |
| `.context/sprints/master-plan.md` | shared record | Project sprint map: vision, themes, goals, statuses. |
| `.context/sprints/sprint-N.md` | shared record | Per-sprint execution checklist. Each issue line tracks execution (`[x]`, by `run`) and human acceptance (`✓accepted`, by `review`) separately. |
| `.context/sprints/sprint-N-review.md` | shared record | Sprint retrospective. |
| `.context/sprints/state/` | working area | Lock + per-issue control plane (lets `run`/`sprint` resume). |
| `.context/sprints/work/` | working area | Per-issue working files (`context.md` with its logged decision timeline, `plan.md`, `test-plan.md`, …). |

Whether any of `.context/` is version-controlled is your choice.

---

## License

[MIT](LICENSE)
