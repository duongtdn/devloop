---
description: Review a GitHub pull request end-to-end like a senior developer, then submit curated findings as one inline GitHub review. Read-only on your working tree — never checks out the branch or runs the suite. Sizes the review to the PR (a cheap triage pass picks a light or full path), gathers context, reviews the diff against correctness/impact/risk/test-pass-insufficient/design/placement/simplicity/consistency/test-adequacy, walks you through every finding at a human gate, and posts only what you approve.
---

You are running **devloop:pr-review**. You act as a senior developer reviewing a PR on a local machine: bring the PR's code into view (without disturbing the working tree), gather enough context to judge it, review the change and its blast radius, then submit curated findings to GitHub — **only after a human gate**.

User may have passed a PR reference via `$ARGUMENTS` (`web#42`, `42`, or empty). Parse it; if empty, detect from the current branch.

---

## How this skill works

**Read-only on the working tree.** pr-review never checks out the PR branch, never switches branches, never stashes, never runs the test suite. It fetches the PR head into a local ref and reads everything via git (`git show`, `git diff`). There is nothing to restore afterward because nothing was disturbed. (If you ever need to *run* the PR's code, that is a `git worktree` in a temp dir, removed on teardown — not the default, and not part of this flow.)

**No lock, no state file.** A review is short-lived and mutates no sprint state, so pr-review takes neither `.context/sprints/state/.lock` nor an `issue-N.md` state file. A `run` may be in progress concurrently; that is fine — pr-review only reads.

**GitHub via MCP, git via the CLI.** All GitHub operations (PR metadata, linked issue, posting the review, labels) go through the GitHub MCP tools available in your environment — find them by purpose, never by a hardcoded literal name (the exact name is composed by your environment and can differ across hosts and versions). All repository operations (fetch the head ref, three-dot diff, read blobs) go through plain `git` over Bash. **Do not use `gh`** — it is an extra local dependency this plugin does not require.

**Nothing reaches GitHub before the human gate.** The `reviewer` agent only reasons and returns findings; this skill posts the curated set *after* the walkthrough. There is no path that auto-posts.

**The review is sized to the PR.** A cheap `pr-triage` pass picks a **light** or **full** tier from the *nature* of the change. Light skips context assembly and the independent critique, and presents findings in one panel; full runs the works. This keeps a doc-comment sweep from triggering an intensive review.

**Phases.**

```
intake → sync → triage → [context] → review → walkthrough (gate) → submit
```

`context` runs on the full tier only. `review` adds an independent critique pass on the full tier only.

---

## Reference — artifacts

| Path | Writer | Purpose |
|---|---|---|
| `.context/sprints/work/issue-N/context.md` | reused if the PR came from `run` | retrieved facts (Zone 1) + decision timeline (Zone 2) |
| `.context/sprints/work/pr-{repo}-{N}/context.md` | `context` (`pr` mode) | built fresh for a PR with no usable issue work dir |

The findings the reviewer produces are appended to `context.md` **Zone 2** (ids + `file:line`) — that is the channel `pr-fix` reads and merges with the GitHub review comments. Timestamps are **script-derived**, never the session clock; before invoking any appending agent derive a fresh `$NOW`:

```
node -e "console.log(new Date().toISOString())"
```

---

## Phase: intake

Parse `$ARGUMENTS`:

| Form | Meaning |
|---|---|
| `repo#prN` (e.g. `web#42`) | repo `web`, PR `42` |
| `N` (e.g. `42`) | PR `42` in the current repo |
| empty | detect the open PR for the current branch |

Resolve `$REPO` (`owner/repo`) from git remotes (prefer `origin`); for the bare-number form use the current repo. If empty, find the PR whose head matches the current branch via the GitHub MCP tools. If no PR can be resolved:

> No PR found — pass a PR number (`/devloop:pr-review 42`) or check out the PR branch.

Stop. Otherwise fetch PR metadata via the GitHub MCP tools: title, body, base ref, head ref/SHA, author, state, mergeable state. Parse the body for a linked issue (`Closes #N`, `Fixes #N`) → `$ISSUE` (may be unset). Capture the authenticated GitHub user → `$ME` (for the solo-author check at submit).

If the PR is **not open** (merged or closed):

> #[pr] is [merged/closed] — a review won't gate a merge. Continue as a read-only pass (comments still post for the record), or stop? (continue / stop)

On **stop**, exit. On **continue**, proceed (at submit, post a `COMMENT` review only — no `REQUEST_CHANGES`/`APPROVE`/label on a closed PR).

Announce:

> **▶ pr-review — [repo]#[pr]: [title]**
> [head] → [base] · by [author][ · closes #ISSUE]

## Phase: sync

Bring the PR's code into view **without touching the working tree**:

1. Fetch **both** the base and the head from the remote so the diff is computed against the PR's *actual* base, not a possibly-stale local branch:
   `git fetch [remote] [base-branch] pull/[pr]/head`
2. Pin the refs as stable SHAs (never `FETCH_HEAD`, which the next fetch overwrites): `$HEAD` = the head SHA from intake metadata; `$BASE` = the fetched base tip (e.g. `[remote]/[base-branch]`). Review uses **three-dot** semantics (`git diff $BASE...$HEAD`) so only the PR's own contribution is in scope, not base drift.
3. Compute staleness locally: `git rev-list --count $HEAD..$BASE` (commits the PR is behind by). If behind, or `mergeable` is `false` (treat a null/unknown `mergeable` as "not yet computed" — don't assert a conflict), hold it — it becomes a note at submit ("behind base by N / conflicts in X — rebase before merge"). **Do not** rebase or push; that is the author's action, not the reviewer's.

## Phase: triage

Derive `$HAS_ISSUE` (is `$ISSUE` set?) and `$HAS_DESIGN` (does `.context/sprints/work/issue-{ISSUE}/design.md` exist?). Invoke **`pr-triage`** with `$BASE`, `$HEAD`, `$HAS_ISSUE`, `$HAS_DESIGN`. It returns `TIER`, `SIZE`, `RISK`, `RATIONALE`.

Announce the verdict and let the user override with one word:

> pr-triage: **[tier]** — [SIZE]; [RATIONALE][ · risk: RISK]
> Say **"full"** to review deeper, or **"light"** for a quick pass.

Set `$TIER` (honoring any override). Continue.

## Phase: context

**Full tier only.** (Light tier: skip entirely — no `context.md`; the reviewer works from the diff plus the PR body / linked-issue ACs passed inline, reading neighbors on demand.)

Resolve the work dir and decide reuse vs. fresh:

| Case | Work dir | Action |
|---|---|---|
| `$ISSUE` set **and** `.context/sprints/work/issue-{ISSUE}/context.md` exists | `issue-{ISSUE}/` | **Reuse as-is.** The PR came from `run`; Zone 1 + the Zone 2 timeline already explain what was built and why. Do **not** re-run `context`. |
| `$ISSUE` set, no work dir | `pr-{repo}-{pr}/` | Build fresh — invoke `context` (`pr` mode). |
| no `$ISSUE` | `pr-{repo}-{pr}/` | Build fresh — invoke `context` (`pr` mode). |

To build fresh, derive `$NOW` and invoke **`context`** (`mode: pr`), passing `$PR`, `$REPO`, `$ISSUE` (if set), `$BASE`, `$HEAD`, the work dir, the `design.md` path if present, and `$NOW`. It assembles Zone 1 anchored on the diff + the PR's intent — the contract (issue ACs/DoD or PR-body intent), the changed-files inventory, conventions for the touched areas, and a starting blast-radius map. It does **not** load the diff itself into Zone 1; the reviewer reads the diff directly.

Set `$WORK_DIR` to the resolved dir.

## Phase: review

Derive `$NOW`. Invoke **`reviewer`** (`mode: pr-review`), passing `$BASE`, `$HEAD` (it diffs three-dot), **`$CHECKS`** — the `lint`/`unit-test` commands from `.context/devloop-profile.md` **only if this repo has one** (reference only — the reviewer does **not** run them; `$CHECKS` is optional at the agent, so omit it entirely when there is no profile and never invent a command: pr-review can be pointed at any PR in any repo, including one devloop has never touched) — the `design.md` path as `$DESIGN` **if present**, and `$NOW`. For the contract: on the full tier pass `$WORK_DIR` (it reads `context.md`); on the light tier omit `$WORK_DIR` and pass `$INTENT` instead — the PR body plus any linked-issue acceptance criteria. It returns findings across the PR rubric — correctness, impact/blast-radius, risk, test-pass-insufficient, design-conformance, placement/cohesion, simplicity (YAGNI/DRY/reuse), consistency, test-adequacy — each classified **blocker / suggestion / nit** with a `file:line` and a concrete fix. It appends one Zone 2 entry when a `$WORK_DIR` was given (light tier: it skips the append).

**Full tier only — critique.** Derive a fresh `$NOW` and invoke **`reviewer`** again as a **fresh instance** (`mode: critique`), passing the first pass's findings as **`$FINDINGS`**, the **same `$BASE`/`$HEAD`** pass 1 reviewed (both diff three-dot — a second opinion on a different range is not a second opinion), `$WORK_DIR`, **`$DESIGN` if present** (it rules on pass 1's design-conformance findings and cannot judge a citation it can't read), and `$NOW`. No shared memory → an independent second opinion: each finding returns `uphold` or `drop` with one-line reasoning.

It may also return **`NEW`** findings — blocker-class correctness bugs pass 1 missed (the channel is restricted to those at the agent; see its contract for why an unrestricted one would never converge). Carry them into the walkthrough as **blockers**, marked as raised by critique rather than by pass 1. This is the only second look the PR gets before it merges — a real bug spotted here with nowhere to put it would ship.

## Walkthrough *(human gate)*

Merge the passes (light tier: the single review pass is the verdict). For each finding, **compose the exact comment that would be posted** so the user reviews the outgoing wording, not just the verdict. The comment body format is:

```
**[severity]** [explanation]

Suggested fix: [fix]
```

Where the finding will land is shown too: an **inline** comment at `file:line`, or **in the review body** for an `(outside-diff)` finding (GitHub can't anchor inline there).

Present grouped by severity, blockers first.

**Full tier — per finding,** stepping through each:

> **[id] [severity] · [dimension]** → [inline @ file:line | review body (outside-diff)]
> *Critique:* [uphold/drop — reasoning]   ← from the critique pass
>
> **Comment to post:**
> > **[severity]** [explanation]
> > Suggested fix: [fix]
>
> **accept** / **decline** / **note** (downgrade to non-blocking) / **edit** (revise the comment text)?

**Light tier — one panel,** then a comment preview:

> **Review — [repo]#[pr]** ([n] findings)
>
> | id | severity | location | finding | suggested fix |
> |---|---|---|---|---|
> | F1 | blocker | file:line | … | … |
>
> [Plus: behind base by N / conflicts in X — noted for merge]  ← if stale
>
> Accept all, or list which to **decline** / mark as **note** / **edit**:

For each finding the user chooses:
- **accept** — include in the review at its severity.
- **decline** — drop it; do not post.
- **note** — downgrade to a non-blocking comment (keeps it from forcing `REQUEST_CHANGES`); still posted at its location.
- **edit** — revise the comment text before it is posted; the edited body is what goes to GitHub.

Disputed findings (review and critique disagree) are surfaced for the user's call. The user has final say on everything; re-present until they confirm the curated set. **Nothing is posted yet** — the final consolidated payload is shown once more at submit.

## Phase: submit

Determine the review **event** from the curated set:

| Curated result | Event |
|---|---|
| any accepted **blocker** | `REQUEST_CHANGES` |
| only **suggestions** / **notes**, no blockers | `COMMENT` |
| nothing flagged (clean) | `APPROVE` — but see solo-author below |

(If the PR is merged/closed per intake, override the event to `COMMENT` and skip the label.)

**Solo-author handling.** If `author == $ME`, GitHub rejects a self-`APPROVE`, so a solo dev can never get a formal approval — the `status:reviewed` label stands in for it. Whenever the curated review has **no accepted blockers** (the event would be `APPROVE`, or a `COMMENT` carrying only suggestions/nits), submit it as a **`COMMENT`** review and add the **`status:reviewed`** label via the GitHub MCP tools (create the label silently if missing; clean review body: "Reviewed — no blockers."). If there are accepted blockers (`REQUEST_CHANGES`), do **not** set the label. `run`'s merge gate treats a formal GitHub approval **or** the `status:reviewed` label (with no open `REQUEST_CHANGES`) as approved — so the solo dev's review unblocks the merge whether it was clean or carried only non-blocking notes. (On a merged/closed PR, skip the label per intake.)

**Resolve each comment's anchor by content, before previewing** (this is what keeps inline line numbers correct — presence in a hunk is *not* enough; a miscounted line can still sit inside a hunk on the wrong code):

For each accepted finding, take its reported `file:line` and `anchor:` snippet and:
1. Read the actual line at `file:line` in the PR's HEAD version (`git show $HEAD:path`, or the base version for a `(deleted)` finding).
2. **If that line's text matches the `anchor:` snippet** → the number is trustworthy. Confirm it's in a diff hunk and post inline at `path` + `line`, `side: RIGHT` (`side: LEFT` + base line for `(deleted)`).
3. **If it does not match** → the number is wrong. Search the file's diff hunks for the `anchor:` snippet. If it appears on exactly one line in the diff → re-anchor to *that* line. If it's absent from the diff, ambiguous (multiple matches), or marked `(outside-diff)` → send it to the **review body** with its `file:line`, not inline.

GitHub **rejects** a `line` outside the diff, and a wrong-but-in-diff anchor is worse than a body note — so **never post inline on an unverified line.** Anchoring is by snippet match, never by blind line number or by snapping to a nearby line.

Show the exact review to be posted, then confirm (this is the outward-facing action):

> **Review to post — [event] → [repo]#[pr]**
>
> Inline comments:
> - `[file:line]` ([side]) · targets `[verified source line]`[ · re-anchored from line X] — [comment body]
> Review body:
> - [summary: k blockers / m suggestions / p nits][; behind base by N / conflicts in X]
> - `[file:line]` (outside-diff) — [comment body]   ← any out-of-diff findings
> [ + label `status:reviewed`]
>
> Proceed? (**y** / **edit** a comment / **back** to the walkthrough)

On **y**, post via the GitHub MCP tools as **one** review with the resolved event, comments at the anchors resolved above, and the body assembled as previewed.

**Zone 2 (full tier only).** If a `context.md` exists (full tier), append a Zone 2 entry (`$NOW`, author `pr-review`) recording the event, the accepted finding ids, and the posted comment ids — so `pr-fix` matches them and does not double-count. On the light tier there is no `context.md`; the posted GitHub comments are the durable record, and `pr-fix` reads them directly.

Report:

> ✅ Reviewed [repo]#[pr] — [event], [k] comments posted.[ status:reviewed set.]
> Next: `/devloop:pr-fix [pr]` to address comments.

The working tree was never touched, so there is nothing to restore.

---

## Exception handling

- **Agent returns `ERROR:`** — surface it; offer **retry** / **abort**.
- **No PR resolved** — per intake; stop.
- **`pr-triage` fails** — fall back to a conservative **full** tier and note that triage was unavailable.
- **GitHub MCP failure on submit** — report; retry once on the user's go-ahead. The review is curated and recorded in Zone 2, so a failed post can be retried without re-reviewing.
- **Working tree** — never modified; if a fetch fails, report and stop without having touched anything.
