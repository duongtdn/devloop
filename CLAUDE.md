## What this plugin is

`devloop` is a Claude Code plugin (package scope `@noetaris`) that automates a full sprint lifecycle: planning, execution (TDD workflow), PR review, and sprint close. Users invoke top-level skills; skills orchestrate sub-agents that each own a narrow role.

The workflow runs at two altitudes (design: `docs/human-on-the-loop.md`):
- **Inner loop** (human-*on*-the-loop): autonomous execution — `run --auto` (one issue, halts at the open PR), `run --auto --merge` / `sprint` (merge-as-you-go across the sprint). Gates don't stop; every decision + reasoning is logged to `context.md` Zone 2 for later audit; the run halts rather than fake a judgment it can't make.
- **Outer loop** (human-*in*-the-loop): the `review` conversation — task scope (`review 42`: explain, demo, accept→merge or rework→`replan`) or sprint scope (walk un-accepted tasks, then reconcile/retro/tag/close). Human acceptance is recorded as a `✓accepted` annotation on the sprint-file issue line — orthogonal to the checkbox, since autonomous execution merges/closes issues before anyone reviews them. Rework is always a **new** issue cross-linked to the shipped one (`Rework of #N` / `Rework tracked in #M`), never a reopen.

The default (no flags) remains fully human-gated: every gate pauses for confirmation.

## Plugin structure

This is a Claude Code plugin — **not** an npm package. The entry point is `.claude-plugin/plugin.json`.

```
devloop/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest — name "devloop" sets the /devloop: namespace
├── .mcp.json                    # Bundled MCP server declarations (GitHub milestone + label gap-fill)
├── bin/                         # Executables added to PATH when plugin is active
│   └── github-extras.js         # Bundled Node.js MCP server for milestone + label operations
├── skills/
│   ├── roadmap/
│   │   └── SKILL.md             # /devloop:roadmap [topic] — init or update master plan from conversation
│   ├── backlog/
│   │   └── SKILL.md             # /devloop:backlog [topic] — distill conversation into type:backlog GitHub issues
│   ├── plan/
│   │   ├── SKILL.md             # /devloop:plan — prepare sprint: backlog triage, issue selection, milestone
│   │   └── plan-spec.md         # Shared spec: issue-body template, DoD-by-type, sprint-file line grammar (read by plan + replan)
│   ├── replan/
│   │   └── SKILL.md             # /devloop:replan — amend the active sprint: add/drop/reorder/re-scope/rework issue
│   ├── run/
│   │   └── SKILL.md             # /devloop:run [issue] [--auto [--merge]] — execute one issue: context → plan → TDD → PR [→ merge]
│   ├── sprint/
│   │   └── SKILL.md             # /devloop:sprint — thin orchestrator: run --auto --merge across the whole sprint
│   ├── status/
│   │   └── SKILL.md             # /devloop:status [sprint-N] — read-only sprint progress snapshot (incl. accepted/awaiting review)
│   ├── review/
│   │   └── SKILL.md             # /devloop:review [issue|sprint-N] — outer loop: task/sprint review conversation + close ceremony
│   ├── abort/
│   │   └── SKILL.md             # /devloop:abort [issue] — clean stop: branch, state, issue decisions
│   ├── pr-review/
│   │   └── SKILL.md             # /devloop:pr-review [repo#prN] — review PR, post inline GitHub comments
│   └── pr-fix/
│       └── SKILL.md             # /devloop:pr-fix [repo#prN] — fix review comments, push replies
├── agents/
│   ├── backlog-triage.md        # Fetches type:backlog issues, classifies against sprint goal, returns table
│   ├── issue-selector.md        # Fetches sprint-ready issues, suggests include/consider/skip per sprint goal, returns table
│   ├── context.md               # Assembles context.md from GitHub issues, docs, codebase patterns. Modes: full/light/pr (diff-anchored)
│   ├── planner.md               # Reads context.md (+ design.md) → plan.md + test-plan.md; may raise NEEDS-DESIGN
│   ├── designer.md              # Design specialist. Modes: design (design.md, flags needs-proof) + critique (score vs criteria)
│   ├── test-writer.md           # Reads test-plan.md → writes failing tests (unit + E2E)
│   ├── coder.md                 # Makes failing tests pass; commits when green. Mode: spike (throwaway PoC, commits nothing)
│   ├── test-runner.md           # Runs tests, classifies failures: new / accepted (baselined) / pre-existing
│   ├── pr-triage.md             # Classifies a PR's review intensity (light/full) from the nature of the diff. Haiku
│   ├── reviewer.md              # Reviews diff (reasoning only, never posts). Modes: review (run), pr-review (broader rubric), critique, fix-review (scoped fix verification)
│   └── scaffolder.md            # Creates repos, bootstraps project structure, commits to main
├── docs/
│   └── human-on-the-loop.md     # Design doc: inner/outer loop, sprint/replan/review interplay, ✓accepted marker
└── CLAUDE.md
```

Skills live in `skills/<name>/SKILL.md`. Agents live in `agents/<name>.md`. The `name` field in `plugin.json` sets the skill namespace, so all skills are invoked as `/devloop:<skill-name>`.

## GitHub integration strategy

The plugin uses the **official GitHub MCP server** for all standard operations (issues, PRs, branches, adding labels to issues) plus a **bundled `github-extras` MCP** (`bin/github-extras.js`) for the operations the official server does not cover — milestones and repository label management:

| Operation | Tool source |
|---|---|
| List/create/close issues, add labels to issues | Official GitHub MCP |
| Create/merge/update PRs | Official GitHub MCP |
| Create/list branches | Official GitHub MCP |
| Read a single label (`get_label`) | Official GitHub MCP |
| **Create milestone** | Bundled `github-extras` MCP |
| **Assign issues to milestone** | Bundled `github-extras` MCP |
| **Close milestone** | Bundled `github-extras` MCP |
| **List repository labels** | Bundled `github-extras` MCP |
| **Create repository label** | Bundled `github-extras` MCP |

The official server has no tool to *list* or *create* repository labels (only `get_label` reads one by name), so the bundled server fills that gap alongside milestones.

Both MCP servers are declared in `.mcp.json` at the plugin root and start automatically when the plugin is active. The official GitHub MCP is wired as the remote server `https://api.githubcopilot.com/mcp/` with `Authorization: Bearer ${GITHUB_TOKEN}`; the bundled `github-extras` stdio server reads the same `GITHUB_TOKEN` from the environment. A single token covers both — the user just exports `GITHUB_TOKEN`.

**Never hardcode an MCP tool's literal name in a skill or agent.** The table above documents *capability → server* for humans; it is not a literal call target. For a plugin-declared MCP server, the harness composes the runtime tool name with an internal, undocumented prefix (observed: `mcp__plugin_<pluginName>_<serverKey>__<tool>`, not the plain `mcp__<serverKey>__<tool>` form the official settings.json permission-rule docs describe) — and it silently differs by host and can change across Claude Code versions. An agent whose `tools:` allowlist or prompt names a specific literal tool string that doesn't match at runtime doesn't just fail cleanly — the model tends to fabricate a plausible-looking result instead of erroring (confirmed via a minimal reproduction plugin). Every agent and skill that touches GitHub must instead: (1) describe the *operation* in plain language and let normal tool selection find the right binding by purpose/description, never by asserted name; (2) omit MCP tools from an agent's `tools:` allowlist entirely (an explicit allowlist entry only works if it happens to match the composed runtime name, which is not safe to assume); (3) carry an explicit instruction to never fabricate — if no suitable tool can be found or a call fails, stop and return `ERROR: [reason]` rather than guessing.

## Central artifacts (written to user's working repo)

| Path | Purpose |
|---|---|
| `.context/devloop-profile.md` | Operational manifest: build/test commands and test layout. Shared project record. Bootstrapped by `roadmap`; read by `plan` and `run`; written back by `run` (scaffold + newly-filled fields). Holds commands only — never stack/conventions (those stay in CLAUDE.md). See `profile-spec.md`. |
| `.context/devloop-baseline.md` | Accepted-failure allowlist: checks known to fail and accepted until a real fix lands. Shared project record. Written by `run` on user decision (needs a tracking issue); read by the `test-runner` agent to classify failures as accepted vs new. Lets the green-check gate mean "no *new* failures," not zero. |
| `.context/sprints/master-plan.md` | Project sprint map: vision, sprint themes, goals, statuses. Created and updated by `roadmap`. `plan` writes `Status: active` and `Sprint file:` per sprint; `review` writes `Status: completed`. |
| `.context/sprints/sprint-N.md` | Sprint execution file. Checkbox list read/updated by `run`; lines amended by `replan`; `✓accepted` annotations written by `review`. Line grammar in `skills/plan/plan-spec.md`. |
| `.context/sprints/state/.lock` | Concurrency guard: active issue number, PID, start time. |
| `.context/sprints/state/issue-{N}.md` | Control plane for one in-progress issue: phase, position (`task_index`/`phase_step`), branch, confirmed plan, task list, log, and a pending-gate payload (lets a gate re-present on resume without re-running its agent). |
| `.context/sprints/work/issue-{N}/context.md` | Central knowledge file. Zone 1: retrieved facts (owned by `context`). Zone 2: append-only decision timeline — `planner`/`test-writer`/`coder`/`reviewer` and `run`'s gates each append a self-contained, script-timestamped entry; never edited. |
| `.context/sprints/work/issue-{N}/plan.md` | Implementation plan from the `planner` agent. |
| `.context/sprints/work/issue-{N}/test-plan.md` | Test strategy: unit scenarios per task + E2E scenarios per flow. |
| `.context/sprints/work/pr-{repo}-{N}/context.md` | Standalone PR work dir (full-tier `pr-review`/`pr-fix` on a PR with no usable issue work dir). Built by `context` (`pr` mode). Part of `run`'s per-issue working area, like the rest of `work/`. |
| `.context/sprints/sprint-N-review.md` | Sprint retrospective from review skill. |

`.context/sprints/work/` and `.context/sprints/state/` are `run`'s per-issue working area; `profile`, `baseline`, `master-plan`, `sprint-N`, and the sprint reviews are shared project records. **Whether any of `.context/` is version-controlled is the user's choice — devloop neither assumes nor enforces a gitignore policy.**

## Key conventions

- **Skill frontmatter**: every `SKILL.md` must have a `description:` field. Use `$ARGUMENTS` for user input after the skill name.
- **Agent frontmatter**: `name`, `description`, `model`, `tools` (allowlist), `disallowedTools`. Agents cannot declare `mcpServers` or `hooks` — plugin-level MCP covers that. Exception: agents that touch GitHub (`backlog-triage`, `issue-selector`, `context`, `scaffolder`, `test-runner`) omit MCP entries from `tools:` on purpose — see [GitHub integration strategy](#github-integration-strategy) for why hardcoding an MCP tool name is unsafe here.
- **Conversational skills** (`roadmap`, `backlog`, `plan`, `replan`, `review`, `abort`): pause at every human gate with explicit confirmation before any destructive action.
- **Autonomy modes** (`run`): `autonomy: human | auto | auto+merge`, set by `--auto` / `--auto --merge` at invocation, persisted in the state file, governs on resume. In auto modes gates decide-and-log instead of pausing (Zone 2 entries attributed to `run (auto)`), spikes are preferred over reasoning for load-bearing assumptions, and the run **stops-the-line** — logs a blocker and exits — wherever human-mode would escalate. Plain `auto` halts at the open PR; `auto+merge` (used by `sprint`) merges and cleans up.
- **Sprint amendments** go through `replan` only — it and `plan` share `skills/plan/plan-spec.md` (issue-body template, DoD-by-type, sprint-file line grammar) so formats never drift. `review` records human acceptance as a `✓accepted YYYY-MM-DD` annotation on the sprint-file line (only `review` writes it; only `run` ticks the checkbox).
- **State machine** (`run`): a resumable phase spine (`context → [design → gate-design] → plan → gate-plan → build → e2e → review → validate → gate-pr → pending-review → merge`). The active **workflow** (feature/bugfix/design/scaffold/manual, chosen from labels and confirmed at gate-plan) selects which phases run. The optional **design** phase produces an implementation guide / decision doc (`design.md`) — always for the design workflow, and for a feature/bugfix when the planner raises `NEEDS-DESIGN`. The **manual** workflow handles issues with no code to build (configure DNS, obtain a sign-off, manual QA) — the planner raises `MANUAL` from the plan phase and run carries the issue to done through a single confirmation gate (`gate-manual`): no branch, tests, or PR. The `designer` authors it and a fresh `designer` instance critiques it against named criteria; load-bearing assumptions can be proven with a throwaway `coder` spike before the gate. Reads `.context/sprints/state/issue-{N}.md` to resume from the last recorded phase; never re-runs a completed phase. Gates are resumable too — the panel-building payload is persisted before a gate is shown, so a crash at a gate re-presents it from disk rather than re-running the agent.
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
