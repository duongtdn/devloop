## What this plugin is

`devloop` is a Claude Code plugin (package scope `@noetaris`) that automates a full sprint lifecycle: planning, execution (TDD workflow), PR review, and sprint close. Users invoke top-level skills; skills orchestrate sub-agents that each own a narrow role.

The workflow runs at two altitudes (design: `docs/human-on-the-loop.md`):
- **Inner loop** (human-*on*-the-loop): autonomous execution — `run --auto` (one issue, run to completion: by default merges locally with no PR), `sprint` (the same across the whole sprint, merge-as-you-go). Gates don't stop; every decision + reasoning is logged to `context.md` Zone 2 for later audit; the run stops-the-line rather than fake a judgment it can't make. Delivery is a separate axis: `--pr` opts into a GitHub PR — in human mode the run then halts at the open PR for review; in auto mode it merges the PR through.
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
│   │   └── SKILL.md             # /devloop:run [issue] [--auto] [--pr] — execute one issue: context → plan → TDD → merge (locally, or via PR with --pr)
│   ├── sprint/
│   │   └── SKILL.md             # /devloop:sprint — thin orchestrator: run --auto across the whole sprint (merge-as-you-go, PR-less)
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
│   ├── context.md               # Assembles context.md from GitHub issues, docs, codebase patterns. Modes: full (self-calibrates depth minimal/standard/deep, biased light) / light / pr (diff-anchored) / deepen (fill one named gap on NEEDS-CONTEXT)
│   ├── planner.md               # Reads context.md (+ design.md) → plan.md (Rung: EXPRESS/STANDARD/REFACTOR) + test-plan.md; may raise NEEDS-CONTEXT / NEEDS-DESIGN / MANUAL
│   ├── designer.md              # Design specialist. Modes: design (design.md, flags needs-proof) + critique (score vs criteria)
│   ├── test-writer.md           # Writes failing tests; never runs them. Modes: unit / e2e / regression (reproduce a blocker). Stops with BLOCKED:narrow-interface rather than force an unsafe cast
│   ├── coder.md                 # Makes failing tests pass; commits when green (= no *new* failures — needs $ACCEPTED). Its green is provisional. Modes: express (collapsed-rung change — EXPRESS or REFACTOR — no pre-written test, green = checks pass) · spike (throwaway PoC, commits nothing)
│   ├── test-runner.md           # The independent verifier (disallowedTools: Write/Edit). Modes: unit/full (classify: new / accepted / pre-existing) + red (did the test actually fail, and for the right reason?)
│   ├── pr-triage.md             # Classifies a PR's review intensity (light/full) from the nature of the diff. Haiku
│   ├── reviewer.md              # Reviews diff (reasoning only, never posts). Modes: review (run), pr-review (broader rubric), critique (uphold/drop + may raise a blocker pass 1 missed), fix-review (scoped fix verification)
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
| **Read / list milestones** (state, `due_on`, issue counts) | Bundled `github-extras` MCP |
| **Assign issues to milestone** | Bundled `github-extras` MCP |
| **Clear an issue's milestone** (`milestone_number: null`) | Bundled `github-extras` MCP |
| **Close milestone** | Bundled `github-extras` MCP |
| **List repository labels** | Bundled `github-extras` MCP |
| **Create repository label** | Bundled `github-extras` MCP |

The official server has **no milestone tools at all** — not even a read — so *every* milestone operation, including simply looking one up, goes through the bundled server (list with `state: all` and pick by number; it returns `state`, `due_on`, and open/closed issue counts). It likewise has no tool to *list* or *create* repository labels (only `get_label` reads one by name). The bundled server fills both gaps.

**Clearing a milestone is a first-class operation, not an edge case** — it is how `review` carries an issue over or sends it to the backlog, and how `replan` drops one, and the `issue-selector` only sees issues with *no* milestone, so an uncleared carry-over doesn't carry over: it vanishes from the process. The official server cannot express it (its milestone field is typed `number`, which rejects `null`; omitting it leaves the milestone untouched), so the bundled server's milestone-assignment operation takes `milestone_number: ['number','null']` — `null` removes the issues from their milestone. It stays **required**, so no accidental omission ever clears one. Never fall back to `gh` for this: `gh` is not a declared devloop dependency, and a skill that reaches for it fails on any machine with a valid token but no `gh` login (`docs/field-reports/2026-07-13-cannot-clear-milestone.md`).

Both MCP servers are declared in `.mcp.json` at the plugin root and start automatically when the plugin is active. The official GitHub MCP is wired as the remote server `https://api.githubcopilot.com/mcp/` with `Authorization: Bearer ${GITHUB_TOKEN}`; the bundled `github-extras` stdio server reads the same `GITHUB_TOKEN` from the environment. A single token covers both — the user just exports `GITHUB_TOKEN`.

**Never hardcode an MCP tool's literal name in a skill or agent.** The table above documents *capability → server* for humans; it is not a literal call target. For a plugin-declared MCP server, the harness composes the runtime tool name with an internal, undocumented prefix (observed: `mcp__plugin_<pluginName>_<serverKey>__<tool>`, not the plain `mcp__<serverKey>__<tool>` form the official settings.json permission-rule docs describe) — and it silently differs by host and can change across Claude Code versions. An agent whose `tools:` allowlist or prompt names a specific literal tool string that doesn't match at runtime doesn't just fail cleanly — the model tends to fabricate a plausible-looking result instead of erroring (confirmed via a minimal reproduction plugin). Every agent and skill that touches GitHub must instead: (1) describe the *operation* in plain language and let normal tool selection find the right binding by purpose/description, never by asserted name; (2) omit MCP tools from an agent's `tools:` allowlist entirely (an explicit allowlist entry only works if it happens to match the composed runtime name, which is not safe to assume); (3) carry an explicit instruction to never fabricate — if no suitable tool can be found or a call fails, stop and return `ERROR: [reason]` rather than guessing.

## Central artifacts (written to user's working repo)

| Path | Purpose |
|---|---|
| `.context/devloop-profile.md` | Operational manifest: build/test commands and test layout. Shared project record. Bootstrapped by `roadmap`; read by `plan` and `run`; written back by `run` (scaffold + newly-filled fields). Holds commands only — never stack/conventions (those stay in CLAUDE.md). |
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
- **Autonomy and delivery** (`run`): two orthogonal axes, both set at invocation, persisted in the state file, governing on resume. **Autonomy** — `autonomy: human | auto`, set by `--auto`; in auto mode gates decide-and-log instead of pausing (Zone 2 entries attributed to `run (auto)`), spikes are preferred over reasoning for load-bearing assumptions, the run **stops-the-line** — logs a blocker and exits — wherever human-mode would escalate, and it **runs to completion (merges)** rather than halting (the human reviews afterward in the outer loop). **Delivery** — `delivery: direct | pr`, set by `--pr`; **direct** (default) merges the branch into base locally with no PR, **pr** opens a GitHub PR. Only the **human + pr** cell halts before merge (at the open PR); every other cell merges within the run. `sprint` drives plain `run --auto` (direct).
- **Sprint amendments** go through `replan` only — it and `plan` share `skills/plan/plan-spec.md` (issue-body template, DoD-by-type, sprint-file line grammar) so formats never drift. `review` records human acceptance as a `✓accepted YYYY-MM-DD` annotation on the sprint-file line (only `review` writes it; only `run` ticks the checkbox).
- **State machine** (`run`): a resumable phase spine (`context → [design → gate-design] → plan → gate-plan → build → e2e → review → validate → [gate-deliver (direct) | gate-pr → pending-review (pr)] → merge`). The active **workflow** (feature/bugfix/design/scaffold/manual, chosen from labels and confirmed at gate-plan) selects which phases run. The optional **design** phase produces an implementation guide / decision doc (`design.md`) — always for the design workflow, and for a feature/bugfix when the planner raises `NEEDS-DESIGN`. The **manual** workflow handles issues with no code to build (configure DNS, obtain a sign-off, manual QA) — the planner raises `MANUAL` from the plan phase and run carries the issue to done through a single confirmation gate (`gate-manual`): no branch, tests, or PR. The `designer` authors it and a fresh `designer` instance critiques it against named criteria; load-bearing assumptions can be proven with a throwaway `coder` spike before the gate. Reads `.context/sprints/state/issue-{N}.md` to resume from the last recorded phase; never re-runs a completed phase. Gates are resumable too — the panel-building payload is persisted before a gate is shown, so a crash at a gate re-presents it from disk rather than re-running the agent.
- **Project profile** (`.context/devloop-profile.md`): the single source for build/test commands — `run` never guesses a command, and never hardcodes which QA runs. It executes exactly the checks the profile lists (`$CHECKS`), locally, as the back-half at every rung. A heavy check the project's CI owns is simply left out of the profile — in `--pr` mode branch protection still gates the merge on CI; `direct` mode has no CI, so the listed checks are the whole gate. `roadmap` bootstraps it, `run` maintains it. Commands only; stack/conventions live in CLAUDE.md (auto-loaded).
- **Rung — process weight is the planner's call, sized to the task** (`run` build phase): the planner returns a rung in `plan.md`, orthogonal to the phase set, chosen by one question — *does the change add/alter behavior, and if not, what proves it safe?* **`STANDARD`** (new behavior → new test, red-verified) is the full TDD path. **`EXPRESS`** (no new behavior, nothing live depends on the touched code → **triviality** grep) and **`REFACTOR`** (no new behavior, but the code is used and is being restructured → **coverage**: the existing suite must stay green) share one **collapsed path** — collapse the test-authoring front half, keep the back half, single-pass review — differing only in that proof. **Lightweight ≠ unverified:** the regression/fitness **back half (the coder runs `$CHECKS`; the `test-runner` independently re-runs the tests) runs at every rung**, a rung never drops a profile check, and `validate`/reachability still runs (for the collapsed rungs it is the *primary* evidence). `run` never picks the rung — the planner does, from context, like `NEEDS-DESIGN`; a mis-called `EXPRESS` **auto-bumps to `STANDARD`** (one-way ratchet) the moment its triviality proof fails or a `new` failure appears (a `REFACTOR` that breaks a test is a regression to fix in place, not a bump; `THIN` coverage on a `REFACTOR` surfaces to the human / stops-the-line rather than refactoring blind). The human may reshape the rung at gate-plan (logged); auto-mode accepts the planner's rung and never downgrades on its own initiative.
- **Context depth is self-calibrated, deepened on demand**: the `context` agent sizes retrieval (`minimal`/`standard`/`deep`) to the issue and biases light; the planner raises `NEEDS-CONTEXT: [specific fact]` when Zone 1 is too thin, and `run` re-invokes `context` in `deepen` mode to append exactly that gap (bounded at 2, then `$CONTEXT_FINAL`). Same delegation rule as everywhere: `run` doesn't assess how much context an issue needs — the specialist signals, `run` reacts. Downstream agents lack GitHub MCP, so `deepen` is also their only path back to a related issue's body.
- **Green-check gate**: "no *new* test failures," not zero failures. Accepted known-failing tests are tracked in `.context/devloop-baseline.md`, and their ids (`$ACCEPTED`) must be passed to **every agent that runs the suite** — the `coder` as well as the `test-runner`. A suite command exits non-zero on an accepted failure just as it does on a real one, so a coder without `$ACCEPTED` can never reach green in a project that has baselined anything.
- **Two runs, two purposes**: the `coder` runs the suite as a *feedback loop* ("should I keep working?") and its green is **provisional** — it is a self-report from the one agent that both wrote the code and wants it to pass. The `test-runner` runs it as the *verdict* (classification against the baseline + independent verification). Skills believe the `test-runner`.
- **Red is verified, not assumed**: `test-writer` may not run tests and `coder` only ever reports green, so without a check *nobody observes the failing state* and "the test failed first" is an unverified claim. `test-runner` (`mode: red`) runs the fresh tests alone and returns `RED` (real assertion failure), `RED-SETUP` (failed on a broken import/fixture — not a meaningful test) or `GREEN` (vacuous). Both bad verdicts bounce back to the `test-writer`, max twice.
- **Blockers ship with a regression test**: a blocker is a bug the whole suite already ran over and missed, so re-running it after a bare patch proves nothing. Blocker fixes go through a mini-TDD loop (`test-writer` `mode: regression` → `test-runner` `mode: red` → `coder` `mode: fix` → `test-runner`). A blocker that genuinely cannot be pinned by a test returns `NOT-REPRODUCIBLE` and ships with the reason recorded in Zone 2 — never with a faked test.
- **A green suite is not always evidence**: the `reviewer` carries a `test-pass-insufficient` dimension for the bug class a passing suite cannot rule out. Two families: **the code runs but takes a lucky path** (concurrency, shared-resource scoping, ordering, idempotency, resource lifecycle, reversibility of state-mutating artifacts), and **the code never runs at all** (reachability/wiring — a symbol whose only callers are its own tests; a schema or guard verified against fixtures the tests built rather than the real producer's output). Findings there are argued from the code and types; "the tests pass" is not grounds to soften one, and `critique` may not drop one on those grounds — to drop a reachability finding it must **name the production caller**. Test helpers and fixtures are reviewed at production rigour (a broken shared helper makes every test using it vouch for broken code), and code copied from `design.md` gets the same scrutiny as new code.
- **An AC is satisfied when it is test-backed *and* reachable**: `validate` traces every automated AC to a **production call path** (composition root → entry point → the symbol the tests assert against) and records it in Zone 2 — "a passing test covers it" is not sufficient, and was the inference that let a green, fully-tested, uncalled resolver merge with a tick beside its AC (`docs/field-reports/2026-07-13-green-but-unreachable.md`). An empty trace is an **unmet AC**: human mode blocks with override, auto-mode routes it back to build as one scoped wiring task and **stops-the-line** if the wiring needs a decision it isn't entitled to make. It is never carried forward as a flag — unlike a manual AC that can't be automated, this is a demonstrable defect with a known fix. The traces also feed `review`, which otherwise reconstructs them by hand.
- **`design.md` is part-normative, part-illustrative**: interfaces, signatures, contracts and module boundaries are **binding**; **code blocks are sketches** — reasoned about, never run or reviewed. The `planner` must never emit a "copy this verbatim from design.md" task: it converts an unreviewed snippet into shipped code precisely because the document is trusted.
- **`review` verifies; it does not relay.** **The log tells you what was *decided*; only the artifact tells you what is *true*.** Zone 2 is authoritative for history and rationale (and where it is silent, `review` reports the silence rather than filling it) — but for any claim about *behavior* it is a self-report by the system that wrote the code, so `review` goes to the artifact before it vouches: grep the production callers, resolve the commit, read the code, run it. Every other artifact it reads is the inner loop's testimony about itself, and a replay of a self-report cannot catch a self-consistent error — code, test and doc all agreeing with each other and disagreeing with the system (`docs/field-reports/2026-07-13-green-but-unreachable.md`: a resolver shipped green, fully tested, called by nothing).
- **Its instruments, cheapest first**: **grep the callers** (an AC whose symbol is called only by its own test is satisfied as a library function and unsatisfied as a behavior — a finding, for one command); **`git log <merge-commit>..HEAD`** (did a later task undo this one); **the demo** — run the change through the system's **real entry point**, never the module the task built, which always works and proves nothing. If it can't be run, `review` says why; it never illustrates output it did not observe, and "not reachable" is a finding, not a failed demo.
- **Two timeframes**: merge-as-you-go means the tree holds later issues too. *What did this task ship?* → its merge commit + `refs/devloop/issue-N`, frozen. *Is it still true?* → `HEAD`, and anything you run. Divergence between them is its own defect class — a later task bypassing an earlier one's guardrail, which **no inner-loop gate can see** (`#46`'s reviewer reads `#46`'s diff, not `#43`'s ACs; `#43`'s tests still pass because its code still *works*, it has merely stopped being *called*). The rework is then raised against the issue that **caused** it, never the one it broke.
- **`review` is a conversation, not a procedure**: the skill specifies the *sources*, the *instruments* (demo · walk the build · explain an artifact · show the failure · dig into a flag · verdict), and the few rules that don't bend — the model chooses which fit the task. Over-scripting a conversational skill buries the load-bearing constraints in choreography. The **sprint close ceremony** (reconcile → retro → tag → close milestone) stays procedural: irreversible outward-facing writes in a format other things read.
- **Git history survives the squash**: `run` squash-merges and deletes the branch, so the coder's per-task commits (cited by SHA in Zone 2) would become unreachable. Before deleting, `run` archives the branch tip at `refs/devloop/issue-N` (a custom ref — a gc root that doesn't clutter `git branch`/`git tag -l`; **local, never pushed**) and records `merge-commit:` + `history-ref:` in the state file. `review` anchors the task's diff to the exact merge SHA rather than grepping `$base` for `Closes #N` (which matches `#4` inside `#42`), and cites a ref only after it resolves.
- **Detection provenance**: any Zone 2 entry recording a defect carries **`Caught by:`** (`test-red` · `typecheck` · `lint` · `reviewer` · `critique` · `validation` · `spike` · `demo` · `human`; the last two are written by `review` in the outer loop). Raw evidence (failing output, stacks) goes to `work/issue-N/logs/` and is cited under **Artifacts** — never pasted into Zone 2, which every downstream agent loads. This is what lets `review` replay *how* a bug was found instead of guessing, and what fills the sprint retro's **Loop calibration** table (which gates actually fire, and which never do).
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
