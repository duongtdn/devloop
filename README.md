# devloop

A Claude Code plugin that automates a full **sprint lifecycle** — planning, execution (TDD), PR review, and sprint close — entirely from inside Claude Code. You drive your project through GitHub issues and milestones; devloop orchestrates specialized sub-agents to do the work, pausing at human gates before anything irreversible.

Everything is grounded in GitHub: issues are the unit of work, milestones are sprints, and PRs are how code lands. devloop keeps a small set of tracked files in your repo (`.context/`) so progress survives across sessions and machines.

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

> **The only thing you must provide is `GITHUB_TOKEN`** — a GitHub Personal Access Token with repo access, exported in your environment before launching Claude Code. Both servers read it; there is no second credential to manage. Without it, devloop cannot read issues, open PRs, or manage milestones and labels.
>
> ```bash
> export GITHUB_TOKEN=ghp_your_token_here
> ```

---

## The workflow

devloop maps the natural arc of a project onto skills. A typical loop:

```
  brainstorm
      │
      ▼
  /devloop:roadmap      → master plan + project profile (build/test commands)
      │
      ▼
  /devloop:backlog      → turn discussion into type:backlog issues
      │
      ▼
  /devloop:plan         → pick a sprint goal, select issues, create a milestone
      │
      ▼
  /devloop:run  ──────► per issue: context → plan → TDD → PR → merge
      │   ▲
      │   └── /devloop:status   (check progress, read-only)
      │   └── /devloop:abort    (cleanly stop a run)
      ▼
  /devloop:pr-review    → review a PR, post inline comments
  /devloop:pr-fix       → address those comments, push replies
      │
      ▼
  /devloop:review       → retro, tag release, close the milestone
```

**You don't have to use all of it.** The PR-review skills work standalone on any PR. `status` and `abort` are utilities around `run`. Use what fits.

---

## Skills

Skills are what you invoke. Most are **conversational** — they pause at every human gate and wait for your explicit confirmation before doing anything outward-facing or destructive.

### Project setup

| Skill | What it's for |
|---|---|
| **`/devloop:roadmap [topic]`** | Initialize or update the project **master plan** (vision, sprint themes, goals) from your current conversation. Also bootstraps the **project profile** (`.context/devloop-profile.md`) — the build/test commands `plan` and `run` rely on. Run this first on a new project. |
| **`/devloop:backlog [topic]`** | Distill a brainstorm conversation into GitHub **backlog issues** (labeled `type:backlog`). Proposes candidates, you confirm/edit, it creates the approved ones. |

### Sprint planning & execution

| Skill | What it's for |
|---|---|
| **`/devloop:plan`** | Prepare a sprint. Establishes the sprint goal, triages backlog issues, selects sprint-ready ones, ensures each has acceptance criteria and a Definition of Done, creates a GitHub **milestone**, sets execution order, and writes the sprint file. |
| **`/devloop:run [issue]`** | The execution engine. Takes one issue from raw ticket to **merged PR**: builds context, plans, and drives a TDD loop (or a scaffold / design / manual flow). A **resumable** state machine — re-invoke to continue from the last completed phase; it never re-runs finished work. Pauses at declared human gates (plan approval, PR approval). |
| **`/devloop:status [sprint-N]`** | Read-only snapshot of a sprint — issue statuses, the in-progress step, milestone due date and progress. No gates, makes no changes. |
| **`/devloop:abort [issue]`** | The escape hatch for `run`. Cleanly stops an in-progress run: releases the lock and hands you control of the branch (delete / keep / park as draft PR) and run state (delete for a fresh restart, or keep to resume). Does **not** close the issue or touch the milestone. |

### Pull request review

| Skill | What it's for |
|---|---|
| **`/devloop:pr-review [repo#prN]`** | Review a PR end-to-end like a senior dev, then submit curated findings as **one inline GitHub review**. **Read-only** on your working tree — never checks out the branch or runs the suite. Sizes the review to the PR, walks you through every finding at a gate, posts only what you approve. |
| **`/devloop:pr-fix [repo#prN]`** | Address review comments end-to-end. Checks out the PR branch (stashing first if needed), merges GitHub comments with prior findings, you triage what to fix, applies each fix with test verification, runs a scoped fix-review to confirm resolution, then — after a final gate — **pushes and replies** to the threads. |

### Sprint close

| Skill | What it's for |
|---|---|
| **`/devloop:review [sprint-N]`** | End-of-sprint ceremony. Reconciles every sprint issue (shipped / carried over / dropped / closed), writes a retrospective, optionally tags a release, **closes the GitHub milestone**, and marks the sprint completed in the master plan. Won't close a milestone while a run is still active. |

---

## Agents

Agents are the workers behind the skills — you don't invoke them directly. Each owns a narrow role and reports back to the orchestrating skill, which owns all human interaction. They're listed here so you understand what's happening under the hood.

| Agent | Model | Role |
|---|---|---|
| **backlog-triage** | haiku | Fetches `type:backlog` issues and classifies each against the sprint goal. Used by `plan`. |
| **issue-selector** | haiku | Fetches sprint-ready issues (no milestone, not backlog) and suggests include/consider/skip per the sprint goal. Used by `plan`. |
| **context** | sonnet | Assembles the central knowledge file (`context.md`) from issues, docs, and codebase patterns. Issue-anchored for `run`, diff-anchored in PR mode. |
| **planner** | sonnet | Turns context (and an approved design) into an ordered task list (`plan.md`) and a test strategy (`test-plan.md`). Can raise `NEEDS-DESIGN` or `MANUAL`. |
| **designer** | sonnet | Design/architecture specialist. Authors an implementation guide / decision doc (`design.md`); a fresh instance critiques it against named criteria. |
| **test-writer** | sonnet | Reads `test-plan.md` and writes the specified **failing** tests (unit + E2E). Never writes production code. |
| **coder** | sonnet | Implements one task to make its failing tests pass, runs the project's checks, commits only when green. Also runs throwaway spikes. |
| **test-runner** | sonnet | Runs tests and classifies every failure as **new / accepted / pre-existing** (using the baseline allowlist). Never edits code. |
| **pr-triage** | haiku | Classifies a PR's review intensity (light/full) from the nature of the diff. Used by `pr-review`. |
| **reviewer** | sonnet | Reviews a diff and surfaces concrete `file:line` findings. Modes: review / pr-review / critique / fix-review. Reasons only — never posts to GitHub. |
| **scaffolder** | sonnet | Creates the repo (if needed) and bootstraps project structure, build tooling, and test setup, committing to the base branch. |

---

## What devloop writes to your repo

devloop keeps its state under `.context/` so work resumes across sessions:

| Path | Committed? | Purpose |
|---|---|---|
| `.context/devloop-profile.md` | ✅ | Build/test commands and test layout. The single source `run` uses — it never guesses a command. |
| `.context/devloop-baseline.md` | ✅ | Accepted-failure allowlist — checks known to fail, so the green gate means "no *new* failures." |
| `.context/sprints/master-plan.md` | ✅ | Project sprint map: vision, themes, goals, statuses. |
| `.context/sprints/sprint-N.md` | ✅ | Per-sprint execution checklist. |
| `.context/sprints/sprint-N-review.md` | ✅ | Sprint retrospective. |
| `.context/sprints/state/` | local | Lock + per-issue control plane (lets `run` resume). |
| `.context/sprints/work/` | gitignored | Per-issue working files (`context.md`, `plan.md`, `test-plan.md`, …). Local only. |

---

## Key conventions

- **Human gates.** Conversational skills pause and wait for explicit confirmation before any destructive or outward-facing action (creating issues, closing milestones, pushing, merging).
- **Resumable runs.** `/devloop:run` is a phase-based state machine. If it's interrupted, just invoke it again — it reads the issue's state file and continues from the last completed phase.
- **Profile-driven.** Build/test commands live in `.context/devloop-profile.md`. Stack and conventions stay in your `CLAUDE.md` (auto-loaded). `run` never invents commands.
- **Green-check gate.** "No *new* test failures," not zero failures — accepted known-failing tests are tracked in the baseline.
- **One active run at a time.** `run` holds a lock while active; `/devloop:abort` releases it cleanly.

---

## License

MIT
