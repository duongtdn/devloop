# Handover — building the remaining devloop skills

Context for the next session. The execution core (`roadmap → plan → run` + 10 agents) is
built and validates. This captures the conventions and decisions established while building
`run`, so they're reused, not re-derived.

## State of the plugin

- **Built skills:** `roadmap`, `backlog`, `plan`, `status`, `run`, `abort`, `pr-review`, `pr-fix`.
- **Built agents (11):** `backlog-triage`, `issue-selector`, `context`, `planner`, `designer`, `test-writer`, `coder`, `test-runner`, `pr-triage`, `reviewer`, `scaffolder`.
- **Remaining skills:** `review` (sprint ceremony).
- **Read first:** `ai-agent-workflow.md` (full spec incl. step-by-step for the 4 remaining skills), `CLAUDE.md` (structure + conventions), `profile-spec.md` (profile + per-agent contract).

## Conventions every skill must follow (the non-obvious ones)

- **Agent names are bare** (`reviewer`, not `agent-reviewer`); the `subagent_type` must equal the agent's `name:`. No prefix anywhere.
- **MCP via server-level grant:** put `mcp__github` (whole server) in an agent's `tools:` — never hardcode individual tool names; runtime discovery handles them. Milestones use the bundled `devloop-milestones` MCP.
- **Never guess a command.** Read `.context/devloop-profile.md`; if a needed command is missing, ask the user and write it back. Stack/conventions live in CLAUDE.md (auto-loaded) — don't duplicate them in the profile.
- **Timestamps are script-derived**, never the session clock: `node -e "console.log(new Date().toISOString())"`. The skill derives `$NOW` and passes it to any agent that appends to Zone 2.
- **Don't prescribe gitignore** — versioning the work/state files is the user's choice.
- **Conversational skills** (`review`, `abort`) pause at every human gate; re-present until explicitly confirmed; confirm before any destructive action.

## Architecture the new skills plug into

- **context.md** — Zone 1 (facts, owned by `context`) + Zone 2 (append-only decision timeline). Entry format `### [time] · [author] · [ref]` with `Did`/`Decisions`/`For next`/`Artifacts`; never edit, only supersede. Agents advertise extra files they create under `Artifacts`.
- **Agents are stateless specialists.** They communicate only via files + their return message. The skill orchestrates and is the sole writer of control-plane files (`state/`, `.lock`).
- **Project profile** (`.context/devloop-profile.md`) = commands only. **Baseline** (`.context/devloop-baseline.md`) = accepted-failing checks; `test-runner` classifies failures **new / accepted / pre-existing**; the gate means "no *new* failures."
- **design.md governs downstream** when present: `test-writer` asserts its interfaces, `coder` implements to them, `reviewer` checks conformance. `pr-fix`'s coder/reviewer must honor this too.

## Patterns proven in `run` — reuse them

- **Delegate reasoning to agents to keep the skill's context lean.** The skill holds structured returns, not diffs/designs. Present gate panels from return summaries + a link to the artifact; don't load full docs into skill context.
- **Author-hosts-critique:** an independent second opinion is a *fresh instance of the same role* (reviewer→reviewer critique, designer→designer critique). No shared memory = genuine independence.
- **Gates are resumable:** persist the panel-building payload to the state file's `## Pending gate` block *before* showing a gate; rebuild from it on resume rather than re-running the agent.
- **Avoid loops with explicit flags:** e.g. `$DESIGN_DECLINED` (planner won't re-bounce), `$ABSENT` (coder won't re-flag a check the user said doesn't exist). Bound retries (3 attempts) then escalate to the user.
- **Make repeated operations idempotent** (scaffold checks-before-create) so resume converges.

## Per-skill notes (specs are in `ai-agent-workflow.md`)

- **`pr-review`** *(BUILT)* — phases `intake → sync → triage → [context] → review → walkthrough (gate) → submit`. **Read-only on the working tree** (fetch PR head ref, `git show`/three-dot `git diff` — never checkout/stash/run the suite); **no lock, no state file**. GitHub via `mcp__github`, repo ops via plain `git` — **no `gh`** (extra dependency we avoid). Decisions made while building, which `pr-fix` must reuse:
  - **`reviewer` no longer posts to GitHub** — it is reasoning-only in all modes. The *skill* posts the curated set after the gate. `reviewer` modes are now: `review` (run; 4 dims; blocker/refactor; two-dot), `pr-review` (PR merge-candidate; 7-dim rubric correctness/impact/risk/design/simplicity/consistency/test-adequacy; **blocker/suggestion/nit**; **three-dot** merge-base diff), `critique` (unchanged). `mcp__github` removed from `reviewer` tools.
  - **`context` gained `pr` mode** — diff-anchored (contract + touched-files + conventions + starting blast-radius); does NOT load the diff into Zone 1. Needs `Bash` (added).
  - **`pr-triage`** (new, haiku) classifies review intensity light/full from the *nature* of the diff, not size. Light tier skips `context` + critique and shows one panel; full runs the works. Skill announces the tier; user overrides with one word.
  - **Work dir reuse:** linked issue with existing `work/issue-N/context.md` → reuse as-is (Zone 2 timeline is gold); else build fresh in `pr-{repo}-{N}/`.
  - **Solo-author approval:** GitHub forbids self-`APPROVE`. When author == authed user and verdict is clean, post a `COMMENT` review + set the **`status:reviewed`** label. `run`'s merge gate now treats formal approval OR that label (no open REQUEST_CHANGES) as "approved." (Edit already applied to run's merge gate.)
  - **Nothing posts before the human gate.** Findings → Zone 2 with ids + `file:line` (+ posted comment ids) = the channel `pr-fix` reads.
  - Does **not** rebase/push the PR — staleness/conflicts are reported as a finding, not fixed (that's the author's job).
- **`pr-fix`** *(BUILT)* — phases `intake → sync → context → findings → triage (gate) → fix loop → verify → [e2e] → re-review → push+reply (gate)`. Invokes `coder` (`mode: fix`, no new tests) + `test-runner` + `reviewer` re-review (`mode: pr-review`, reasoning-only — push replies via the skill, not the agent). Same work-dir resolution + `context` `pr` mode as `pr-review`; merges GitHub inline comments with Zone 2 findings (posted-comment-id first, then `(file,line)`); honors profile commands, baseline buckets, `design.md` conformance, `$NOW`, Zone 2 appends; `git` + `mcp__github`, no `gh`. Decisions made while building:
  - **It mutates the working tree** — unlike `pr-review`. Checks out the PR branch in the **main workspace** (so fixes build/test against installed deps), gated by a clean-tree check that offers **stash + restore on exit**; remembers `$PRIOR_BRANCH`. No worktree (deps would be missing → `test-runner` fails).
  - **Takes the `.lock`, no state file.** Shares the main tree, so a live `run` for another issue blocks it; otherwise it acquires the lock for the duration. No `issue-N.md` — each fix is its own commit, so progress persists in git; a re-invoke re-reads findings and continues. **`teardown`** is conditional (checkout only if branch switched, pop only if stashed, release only if lock acquired) and **every exit routes through it**.
  - **Two human gates:** triage (which findings to fix/skip) and push+reply (outward-facing — confirm before push + thread replies). Re-review is reasoning-only; fix-induced new blockers → **bounded 2-round** gate.
  - **Replies:** fixed findings with a GitHub thread → reply (`Fixed in <sha>`) + resolve; **skipped** findings also get a reply explaining the skip; Zone 2-only findings (no thread) recorded in Zone 2 only.
  - **Stale-review invariant:** pushing new commits invalidates a prior clean review, so if `status:reviewed` is present `pr-fix` **removes it** (else `run`'s merge gate would treat it as approval) and directs the user to re-run `pr-review`. Does **not** dismiss the reviewer's `CHANGES_REQUESTED`.
  - **`test-runner` runs once** (the `verify` phase), not per-fix — the coder already runs `unit-test` before each commit, so per-fix green is guaranteed; the single pass adds baseline classification + cross-fix regression detection. Pre-existing failures are **report-count-only** (filing/baselining is `run`'s job).
  - **`coder` fix-mode contract widened:** `coder.md` step 1 now states `$TASK` may be an inline finding and `plan.md` may be absent (the `pr-fix` case) — work from the finding + `context.md`. `coder` auto-discovers `design.md` in `$WORK_DIR`, so the skill does **not** pass `$DESIGN` to it (only `reviewer` takes `$DESIGN`).
- **`review`** (sprint ceremony) — conversational: load sprint file + milestone, completion summary gate, handle unfinished issues (carry-over/close/keep), retro draft, demo tags, close milestone (milestones MCP). Writes `sprint-N-review.md`; sets master-plan `Status: completed`.
- **`abort`** — conversational: read `state/issue-N.md` (or `.lock`), branch decision (delete/keep/draft-PR), issue decision (backlog/keep), cleanup, **release the lock**. Does *not* close the issue or tick the sprint checkbox.

## Decisions already settled (don't re-litigate)

- The **skill** owns the phase/workflow shape; agents inform (e.g. planner raises `NEEDS-DESIGN`, skill reacts). The skill never reasons about complexity itself.
- **validate** blocks-with-override, not hard-block.
- **Lock** released at clean exit, `pending-review`, and `merge`; stale-PID auto-cleared.
- **Spike** = `coder` throwaway, commits nothing, runs before any branch exists (design phase is upstream of gate-plan).
- Keep agents single-purpose; the only multi-mode agents (`reviewer`, `designer`, `coder`, `context`, `test-runner`) are justified by shared competence — don't split or further combine without a clear reason.

## Verify

- `claude plugin validate .` — expect one begin warning (CLAUDE.md at root not loaded as plugin context).
- `/reload-plugins` to test locally; `claude --plugin-dir ./devloop`.
