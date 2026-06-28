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
│   ├── planner.md               # Reads context.md → produces plan.md and test-plan.md
│   ├── test-writer.md           # Reads test-plan.md → writes failing tests (unit + E2E)
│   ├── coder.md                 # Makes failing tests pass, commits when checks are green
│   ├── test-runner.md           # Runs tests, classifies failures: new vs pre-existing
│   ├── reviewer.md              # Reviews diff: correctness, DRY, reuse, consistency
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
| **Create milestone** | Bundled `devloop:milestones` MCP |
| **Assign issues to milestone** | Bundled `devloop:milestones` MCP |
| **Close milestone** | Bundled `devloop:milestones` MCP |

The bundled MCP is declared in `.mcp.json` at the plugin root and starts automatically when the plugin is active. It reads `GITHUB_TOKEN` from the environment — the same token the official MCP requires, so there is no additional auth burden on the user.

## Central artifacts (written to user's working repo)

| Path | Purpose |
|---|---|
| `context/sprints/master-plan.md` | Project sprint map: vision, sprint themes, goals, statuses. Created and updated by `roadmap`. `plan` writes `Status: active` and `Sprint file:` per sprint; `review` writes `Status: completed`. |
| `context/sprints/sprint-N.md` | Sprint execution file. Checkbox list read/updated by `run`. |
| `context/sprints/state/.lock` | Concurrency guard: active issue number, PID, start time. |
| `context/sprints/state/issue-{N}.md` | Control plane for one in-progress issue: step, branch, task list, log. |
| `context/sprints/work/issue-{N}/context.md` | Central knowledge file. Two zones: Zone 1 (retrieved facts), Zone 2 (agent notes). |
| `context/sprints/work/issue-{N}/plan.md` | Implementation plan from agent-planner. |
| `context/sprints/work/issue-{N}/test-plan.md` | Test strategy: unit scenarios per task + E2E scenarios per flow. |
| `context/sprints/sprint-N-review.md` | Sprint retrospective from review skill. |

`context/sprints/work/` is gitignored — persists locally only.

## Key conventions

- **Skill frontmatter**: every `SKILL.md` must have a `description:` field. Use `$ARGUMENTS` for user input after the skill name.
- **Agent frontmatter**: `name`, `description`, `model`, `tools` (allowlist), `disallowedTools`. Agents cannot declare `mcpServers` or `hooks` — plugin-level MCP covers that.
- **Conversational skills** (`roadmap`, `backlog`, `plan`, `review`, `abort`): pause at every human gate with explicit confirmation before any destructive action.
- **State machine** (`run`): reads `context/sprints/state/issue-{N}.md` to resume from the last recorded step. Never re-runs a completed step on resume.
- **Lock discipline**: `run` writes `.lock` on start, deletes it on clean exit. Stale lock (dead PID) is auto-cleared with a warning.

## Development

```bash
# Test locally
claude --plugin-dir ./devloop

# Reload after edits (no restart needed)
/reload-plugins

# Validate before distributing
claude plugin validate
```
