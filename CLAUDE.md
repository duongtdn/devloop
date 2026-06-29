## What this plugin is

`devloop` is a Claude Code plugin (package scope `@noetaris`) that automates a full sprint lifecycle: planning, execution (TDD workflow), PR review, and sprint close. Users invoke top-level skills; skills orchestrate sub-agents that each own a narrow role.

## Plugin structure

This is a Claude Code plugin — **not** an npm package. The entry point is `.claude-plugin/plugin.json`.

```
devloop/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest — name "devloop" sets the /devloop: namespace
├── .mcp.json                    # Bundled MCP server declarations (GitHub milestone gap-fill)
├── bin/                         # Executables added to PATH when plugin is active
│   └── github-milestones        # Bundled Node.js MCP server for milestone operations
├── skills/
│   ├── roadmap/
│   │   └── SKILL.md             # /devloop:roadmap [topic] — init or update master plan from conversation
│   ├── backlog/
│   │   └── SKILL.md             # /devloop:backlog [topic] — distill conversation into type:backlog GitHub issues
│   ├── plan/
│   │   └── SKILL.md             # /devloop:plan — prepare sprint: backlog triage, issue selection, milestone
│   ├── run/
│   │   └── SKILL.md             # /devloop:run [issue] — execute sprint: context → plan → TDD → PR
│   ├── status/
│   │   └── SKILL.md             # /devloop:status [sprint-N] — read-only sprint progress snapshot
│   ├── review/
│   │   └── SKILL.md             # /devloop:review — end-of-sprint ceremony: retro, tags, close milestone
│   ├── abort/
│   │   └── SKILL.md             # /devloop:abort [issue] — clean stop: branch, state, issue decisions
│   ├── pr-review/
│   │   └── SKILL.md             # /devloop:pr-review [repo#prN] — review PR, post inline GitHub comments
│   └── pr-fix/
│       └── SKILL.md             # /devloop:pr-fix [repo#prN] — fix review comments, push replies
├── agents/
│   ├── backlog-triage.md        # Fetches type:backlog issues, classifies against sprint goal, returns table
│   ├── issue-selector.md        # Fetches sprint-ready issues, suggests include/consider/skip per sprint goal, returns table
│   ├── context.md               # Assembles context.md from GitHub issues, docs, codebase patterns
│   ├── planner.md               # Reads context.md (+ design.md) → plan.md + test-plan.md; may raise NEEDS-DESIGN
│   ├── designer.md              # Design specialist. Modes: design (design.md, flags needs-proof) + critique (score vs criteria)
│   ├── test-writer.md           # Reads test-plan.md → writes failing tests (unit + E2E)
│   ├── coder.md                 # Makes failing tests pass; commits when green. Mode: spike (throwaway PoC, commits nothing)
│   ├── test-runner.md           # Runs tests, classifies failures: new / accepted (baselined) / pre-existing
│   ├── reviewer.md              # Reviews diff: correctness, DRY, reuse, consistency, design-conformance. Modes: review/critique/pr-review
│   └── scaffolder.md            # Creates repos, bootstraps project structure, commits to main
└── CLAUDE.md
```

Skills live in `skills/<name>/SKILL.md`. Agents live in `agents/<name>.md`. The `name` field in `plugin.json` sets the skill namespace, so all skills are invoked as `/devloop:<skill-name>`.

## GitHub integration strategy

The plugin uses the **official GitHub MCP server** for all standard operations (issues, PRs, branches, labels) plus a **bundled milestone MCP** (`bin/github-milestones`) for the three operations the official server does not cover:

| Operation | Tool source |
|---|---|
| List/create/close issues, add labels | Official GitHub MCP |
| Create/merge/update PRs | Official GitHub MCP |
| Create/list branches | Official GitHub MCP |
| **Create milestone** | Bundled `devloop-milestones` MCP |
| **Assign issues to milestone** | Bundled `devloop-milestones` MCP |
| **Close milestone** | Bundled `devloop-milestones` MCP |

The bundled MCP is declared in `.mcp.json` at the plugin root and starts automatically when the plugin is active. It reads `GITHUB_TOKEN` from the environment — the same token the official MCP requires, so there is no additional auth burden on the user.

## Central artifacts (written to user's working repo)

| Path | Purpose |
|---|---|
| `.context/devloop-profile.md` | Operational manifest: build/test commands and test layout. **Committed.** Bootstrapped by `roadmap`; read by `plan` and `run`; written back by `run` (scaffold + newly-filled fields). Holds commands only — never stack/conventions (those stay in CLAUDE.md). See `profile-spec.md`. |
| `.context/devloop-baseline.md` | Accepted-failure allowlist: checks known to fail and accepted until a real fix lands. **Committed.** Written by `run` on user decision (needs a tracking issue); read by the `test-runner` agent to classify failures as accepted vs new. Lets the green-check gate mean "no *new* failures," not zero. |
| `.context/sprints/master-plan.md` | Project sprint map: vision, sprint themes, goals, statuses. Created and updated by `roadmap`. `plan` writes `Status: active` and `Sprint file:` per sprint; `review` writes `Status: completed`. |
| `.context/sprints/sprint-N.md` | Sprint execution file. Checkbox list read/updated by `run`. |
| `.context/sprints/state/.lock` | Concurrency guard: active issue number, PID, start time. |
| `.context/sprints/state/issue-{N}.md` | Control plane for one in-progress issue: phase, position (`task_index`/`phase_step`), branch, confirmed plan, task list, log, and a pending-gate payload (lets a gate re-present on resume without re-running its agent). |
| `.context/sprints/work/issue-{N}/context.md` | Central knowledge file. Zone 1: retrieved facts (owned by `context`). Zone 2: append-only decision timeline — `planner`/`test-writer`/`coder`/`reviewer` and `run`'s gates each append a self-contained, script-timestamped entry; never edited. |
| `.context/sprints/work/issue-{N}/plan.md` | Implementation plan from the `planner` agent. |
| `.context/sprints/work/issue-{N}/test-plan.md` | Test strategy: unit scenarios per task + E2E scenarios per flow. |
| `.context/sprints/sprint-N-review.md` | Sprint retrospective from review skill. |

`.context/sprints/work/` is gitignored — persists locally only.

## Key conventions

- **Skill frontmatter**: every `SKILL.md` must have a `description:` field. Use `$ARGUMENTS` for user input after the skill name.
- **Agent frontmatter**: `name`, `description`, `model`, `tools` (allowlist), `disallowedTools`. Agents cannot declare `mcpServers` or `hooks` — plugin-level MCP covers that.
- **Conversational skills** (`roadmap`, `backlog`, `plan`, `review`, `abort`): pause at every human gate with explicit confirmation before any destructive action.
- **State machine** (`run`): a resumable phase spine (`context → [design → gate-design] → plan → gate-plan → build → e2e → review → validate → gate-pr → pending-review → merge`). The active **workflow** (feature/bugfix/design/scaffold, chosen from labels and confirmed at gate-plan) selects which phases run. The optional **design** phase produces an implementation guide / decision doc (`design.md`) — always for the design workflow, and for a feature/bugfix when the planner raises `NEEDS-DESIGN`. The `designer` authors it and a fresh `designer` instance critiques it against named criteria; load-bearing assumptions can be proven with a throwaway `coder` spike before the gate. Reads `.context/sprints/state/issue-{N}.md` to resume from the last recorded phase; never re-runs a completed phase. Gates are resumable too — the panel-building payload is persisted before a gate is shown, so a crash at a gate re-presents it from disk rather than re-running the agent.
- **Project profile** (`.context/devloop-profile.md`): the single source for build/test commands — `run` never guesses a command. `roadmap` bootstraps it, `run` maintains it. Commands only; stack/conventions live in CLAUDE.md (auto-loaded).
- **Green-check gate**: "no *new* test failures," not zero failures. Accepted known-failing tests are tracked in `.context/devloop-baseline.md`.
- **Lock discipline**: `run` writes `.lock` on start, deletes it on clean exit, at `pending-review`, and at `merge`. Stale lock (dead PID) is auto-cleared with a warning.

## Development

```bash
# Test locally
claude --plugin-dir ./devloop

# Reload after edits (no restart needed)
/reload-plugins

# Validate before distributing
claude plugin validate
```
