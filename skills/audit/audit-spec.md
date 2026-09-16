# Audit spec — what a whole-system audit looks for, and what counts as a finding

The single source of truth for **auditing a system as it stands**, rather than a change as it lands.
Read by `/devloop:audit` (every invocation) and the `auditor` agent (every mode). The rules that bite
are restated at each write site; this file owns the reasoning behind them.

Every other quality gate in devloop is scoped to a delta:

| Gate | Sees | Blind to |
|---|---|---|
| `reviewer` · review | one branch's diff | anything the diff did not touch |
| `reviewer` · pr-review | one PR | the same |
| `test-critic` | one issue's test *plan*, before the tests exist | the assembled suite |
| `/devloop:review` | one sprint's outcomes | the accumulated system |
| `/devloop:docs` audit | doc ↔ code drift | design, tests, failure, security |

Not one of them can see **accumulation**. Each issue adds one reasonable abstraction, handles its own
errors plausibly, exports one more symbol — and no single diff was ever wrong. Twenty issues later the
system carries six layers nobody needs, five incompatible failure policies, and a suite that cannot
fail. This is the periodic physical against the per-visit checkups, and it is the only pass in the loop
that reads the present tense.

**The audit never writes production code.** Not a deletion, not a rename, not a test. Three reasons,
and the second is decisive on its own: it would be the one code path in devloop that skipped `run`'s
plan → red → green → review → critique → validate; it would be refactoring behind the very detector it
just declared untrustworthy; and proposer and verifier must stay separate, as they are everywhere else
in this plugin. Read-only also means it needs no lock and can run at any time, including during a
`run` — the same stance `/devloop:docs` takes.

---

## 1. The finding grammar — the whole defence against drift

An audit that reports qualities produces taste: unarguable, unactionable, infinite. An audit that
reports **sweep results** produces work. So every dimension in § 4 is written as a *procedure over the
repository*, never as an adjective, and every finding carries the result of one.

**A finding is a claim plus the mechanical result that makes it checkable.** No result, no finding.

| Field | Rule |
|---|---|
| `id` | dimension letter + number — `G-3`. Stable within one report; cited by every issue filed from it |
| `grade` | `blocker` · `debt` · `note` · `unowned` (§ 2) |
| `anchor` | `file:line`. Two anchors where the finding *is* a relationship — a duplicate, a disagreement between two sources of truth, a claim and the code that contradicts it |
| `claim` | one sentence: what is wrong. Not what it violates |
| `evidence` | the sweep result — the grep and its hits, the implementation count, the call sites, the assertion quoted, the type that cannot hold |
| `fix` | one concrete named edit: delete X, inline Y into Z, move A to `b.ts`, assert on C instead of the mock |
| `cost` | `small` (one file, mechanical) · `medium` (a module, behaviour held by tests) · `large` (cross-module, or needs a decision first) |

Three tests, applied before a finding is written down. Each one kills a specific failure mode:

- **Name the destination, or drop it.** "This violates SRP" is taste. "`PACKAGE_VERSION` is about the
  package, this file is about one narrow thing → move it to `version.ts`" is one action a reader can
  check. If you cannot name the file, the symbol, or the edit, you do not have a finding.
- **Show the sweep, or drop it.** If the evidence line is a reading of the code rather than a result
  from it, the finding is an impression. Impressions are exactly what a whole-repo pass produces in
  bulk, which is why this rule is absolute rather than a preference.
- **Argue from the code and the types, never from the tests.** "The suite is green here" is not
  evidence of correctness — it says only that the schedule taken and the inputs built happened to
  avoid the defect. A dimension that stands down because tests pass has been disabled by the thing it
  was sent to inspect.

**Cost is not severity and never modifies it.** A `large` cost is a scheduling fact, not a reason to
downgrade a blocker or to stay quiet. It belongs in the finding so the human can weigh a fix that
touches thirty files against the layer it removes — that judgment is theirs, and it needs the number.

---

## 2. Grades — and why `unowned` sits in the same column

| Grade | Means | Routes to |
|---|---|---|
| **`blocker`** | broken or unsafe **now** — reachable security defect, a feature nothing calls, a test that vouches for broken code, an invariant violation that is swallowed | `/devloop:replan` → the active sprint |
| **`debt`** | real, priced, and it can wait for planning | issues, `source:audit` |
| **`note`** | worth knowing; no action proposed, or the proposal is "accept and record" | the ledger (§ 8), or nothing |
| **`unowned`** | the code is **incoherent and no rule exists** — a cross-cutting concern nobody ever decided | `/devloop:architect` → an ADR |

`unowned` is the finding class that cannot become an issue. *"Code violates a rule"* is work someone
can scope. *"Make error handling consistent"* is not: there is nothing to be consistent **with**, so
the `coder` would have to invent the policy mid-run — which is precisely how the fifth policy got
there. A decision has to land before work can be written down.

It shares the grade column rather than getting an axis of its own, deliberately. A second field would
be this spec committing the sin it exists to find: structure added for a case that does not need it.
`unowned` findings are ranked among themselves by **how much downstream work each unblocks**, not by
severity — severity does not mean anything for a decision that has not been made.

**Cap `unowned` at three per audit.** A report demanding nine architecture decisions is the
unreadable wall in a different costume, and none of the nine will happen.

---

## 3. Before the sweeps — applicability, and the manifest

**3.1 · Decide what applies.** Read `.context/devloop-profile.md`, the entry points, and the shape of
the repository, then mark each dimension of § 4 **applicable** or **not applicable, with the reason**.
A CLI has no CORS. A stateless transformer has no `G`. Deciding this first is what keeps the report
free of noise — and writing the reason down is what stops "not applicable" from becoming a place to
hide work.

**3.2 · Offer the cheap instruments, once.** Coverage and lint results make `C`, `D` and `G`'s proof
tier dramatically sharper, and both come from commands the profile already holds. Offer to run them
**before** fan-out, read-only, once — never per dimension, never from inside the `auditor`. If the
user declines, or the profile has no command, the affected sweeps fall back to static reading **and
the manifest records the degradation**. An audit that quietly lost an instrument reports the same
clean as an audit that used one.

**3.3 · Silence is not clean.** Every applicable dimension must report back either findings **or** the
sweeps it ran and what they returned. A dimension that returns nothing still shows its work:

```
D · test-suite integrity — swept clean
  cannot-fail: 412 test bodies, 0 without an assertion on the subject
  mock-only: 37 suites with full stubbing, all 37 assert observable state
  skipped: 2 (`.skip`), both < 1 sprint old, both tracked
```

This is the only defence against the miss that matters: not the finding that was wrong, but the
dimension that was never run and read, in the report, exactly like one that was.

---

## 4. The dimensions

Nine. Each is written as **asks · sweeps · evidence · grade · out of scope**, and the out-of-scope
line is load-bearing — it is what stops budget leaking into the places where findings are infinite and
cheap.

### A · Design & YAGNI

**Asks:** does the structure carry weight the system actually needs?

**Sweeps**
1. **Abstraction census** — for each interface, protocol, abstract base, strategy registry, factory:
   count implementations and call sites. **One implementation, one caller, no ADR requiring the seam**
   → inline it.
2. **Pass-through trace** — take one representative request or command end to end; list every hop that
   transforms nothing: the delegating method, the wrapper whose body is one call, the re-export.
3. **Single-valued configuration** — options, env vars, feature flags whose other branch no code path
   and no test ever takes.
4. **Unextended extension points** — registries, hook lists, event buses, plugin loaders with exactly
   one subscriber.
5. **Cross-module duplication** — one rule implemented in two modules, or **one flow implemented
   twice** behind two entry points: a CLI command and an HTTP route that each do the work themselves.
   Within a diff the `reviewer` catches the first kind; across sprints nothing catches either.
6. **Under-abstraction — the counterweight.** A dependency hard-wired where a seam is genuinely
   needed: `new Date()`, direct filesystem, clock or network calls threaded through logic, so a rule
   cannot be exercised without I/O. The evidence is in the tests and it is hard — a test that had to
   patch the module loader, stub a global, or run real I/O to reach a decision. **This dimension must
   be able to say "add a seam".** An audit that only ever deletes abstraction is not applying YAGNI,
   it is applying a bias, and what it leaves behind is untestable rather than simple.
7. **Surface area** — exported symbols whose only callers live inside their own module. Harmless
   today, and the raw material of tomorrow's coupling.

**Evidence:** counts and call sites, named. Every finding names a deletion, an inlining or a merge —
or, for sweep 6, the seam and the caller that will inject it.

**Grade:** `debt`, unless the structure causes a defect now — a load-order hazard, or a seam so
missing that a rule the system depends on has no test at all — then `blocker`.

**Out of scope:** "restructure this module", encapsulate-what-varies, and anything resting on a
prediction about how the system will change. Those need judgment about the future and belong to
`/devloop:architect` with a human present; raising them here would reproduce the exact speculative
generality this dimension exists to remove. **Measured** coupling and cohesion are not judgment and
belong to `B` — what stays out here is the unmeasured kind.

### B · Coupling & cohesion

**Asks:** is the structure in the right *places* — and what does the evidence say, rather than taste?

SRP, cohesion and coupling are the classic home of the unfalsifiable review comment, which is why
`reviewer.md` forbids them on a diff: reading one change, the only available argument is an adjective.
**A whole-system pass has what a diff reviewer lacks** — the import graph and the commit history — and
against those, each of these becomes a measurement with two anchors and a named move. That is the
entire licence for this dimension, and the limit of it: **measure, or stay silent.**

Two instruments, shared by every sweep: the **import graph** (built once, per module and per symbol)
and **`git log`** over recent history — the project's own record of what changes together, and why.

**Sweeps — coupling**
1. **Hubs and chokepoints** — fan-in and fan-out per module. One module importing twenty; one module
   twenty import. The count is the finding, and the list comes with it.
2. **Direction and cycles** — imports running against the architecture stated in `docs/` or an ADR;
   import cycles, with the cycle printed.
3. **Boundary bypass** — deep imports reaching past a module's entry point into its internals
   (`billing/internal/calc` rather than `billing`). Each one is a coupling nobody declared.
4. **Type leak across a layer** — an inner layer's types in an outer layer's public signature: an ORM
   entity inside an HTTP response type, a database row shape in a domain function.
5. **Change coupling (temporal)** — files in *different* modules that keep changing together: *"these
   two co-changed in 14 of the last 16 commits that touched either"*. Coupling measured from what
   actually happened rather than from what the imports admit — and nothing else in devloop can see it.
   Two anchors; the fix names the merge, or the interface that should sit between them.
6. **Shared mutable reach** — how many modules touch one global, singleton, or ambient store.

**Sweeps — cohesion**
7. **Disjoint client sets** — module `M` exports `a`, `b`, `c`; `a` is imported only by `X`, `b` only
   by `Y`, `c` only by `Z`, and none of the three call each other. `M` is three modules wearing one
   name. The client sets name the pieces, so the split is the fix.
8. **Misplaced symbol** — a symbol whose callers all live in one *other* module → move it there. The
   `reviewer` raises this per diff as placement; system-wide it needs the whole call graph.
9. **Dumping grounds** — `utils`, `helpers`, `common`, `misc`, `shared`: modules named for nothing, so
   nothing can be wrong to put in them. Split by caller cluster — sweep 7 supplies the clusters.
10. **Peer inconsistency** — files in the same role and the same directory built three different ways:
    one handler with a service layer, one with inline SQL, one with a repository. Compare peers, list
    the shapes, and let the fix name which shape wins. This is not style: two of the three will one
    day be maintained by someone who assumed the third.

**Sweep — SRP, made empirical**
11. **Reasons to change, counted.** *"One reason to change"* is unfalsifiable from static code, which
    is exactly how it decays into taste. devloop's own record makes it measurable: **map commits to
    the issues they closed, and issues to their `epic:` / `area:` labels.** A file edited by issues
    from three unrelated epics has three reasons to change — and the epic names name the three pieces.
    Where labels are missing, fall back to the subjects of the commits themselves and say in the
    evidence that the reading is the weaker one.

**Evidence:** two anchors and a number, every time — the fan-in count, the co-change tally, the client
sets, the epic labels. A sentence about responsibilities with no measurement behind it is precisely
what this dimension exists to replace.

**Grade:** `debt`. `blocker` only where the structure causes a defect now — a cycle that breaks load
order, a bypassed boundary that skips a check the entry point performs. Where the measurement is clear
but the move is large and contested — a package-by-layer tree that should be package-by-feature — the
finding is **`unowned`**: that is a decision, not a task, and it goes to `/devloop:architect`.

**Out of scope:** coupling as an adjective. *"Tightly coupled"*, *"poor separation of concerns"*,
*"leaky abstraction"* — with no count, no tally and no named move — are not findings here at any grade.
They are the `reviewer`'s forbidden category arriving through a different door, and they would bury
the eleven sweeps above in prose nobody can act on.

### C · Drift & code smells

**Asks:** has the code drifted from what it says it is?

**Sweeps**
1. **Dead code** — unreferenced exports (grep production callers; hits only from the definition and
   its own test file count as none), unreachable branches, commented-out blocks, orphan files.
2. **Name / behaviour drift** — a symbol whose name no longer describes what it does. The strongest
   single signal that code moved and its design did not.
3. **Two ways to do one thing** — two HTTP clients, two date libraries, two config readers, two ways
   to build the same URL.
4. **Comments that contradict the code.** `/devloop:docs` audits documents; nothing audits inline
   comments, and a comment that lies is worse than none because it is read with more trust.
5. **Dependency hygiene** — unused dependencies, two dependencies solving one problem, a heavy
   dependency pulled in for a single call.
6. **Oversized units** — only with a named destination for the extracted piece (§ 1).

**Evidence:** the grep and its hits; for drift, the name beside the behaviour.

**Grade:** `debt`. Dead code that *looks* like an API — a stub `export const` nothing imports — is
still `debt`, but say so in the claim: the next reader will import it and believe it.

**Out of scope:** formatting, line length, magic numbers, naming style. The linter owns them, findings
there are infinite, and spending the budget on them is how the report becomes something nobody reads.

### D · Test-suite integrity

**Asks:** would this suite fail if the product broke?

The framing the sweeps serve: **a test is an assertion about a behaviour someone would care about if
it broke.** Nobody would care → cost with no benefit. It cannot fail → cost with *negative* benefit,
because it vouches for the code it never exercised.

**Sweeps**
1. **Cannot-fail** — no assertion; asserts a literal; asserts only call counts on a mock defined in
   the same test; the subject is never invoked.
2. **Tautological** — the expected value is computed by the same expression the code uses.
3. **Mock-only** — every collaborator stubbed, so the test asserts the stubs and never the system.
   Read what feeds the subject in production and compare.
4. **Scaffolding tests** — tests covering demo, sample, example or fixture code that is not product.
5. **Skipped and quarantined** — `.skip`, `xit`, `@Ignore`, plus every `.context/devloop-baseline.md`
   entry: **how many sprints has this been off, and is its tracking issue still open?**
6. **Over-testing** — several tests asserting one behaviour through different doors; tests pinned to
   implementation detail rather than behaviour. These are what make refactoring expensive, so they
   belong in an audit whose output is a refactor plan.
7. **Missing proof** — acceptance criteria on closed issues with no test tracing to them, and every
   open row in `.context/devloop-unproven.md`.

**Evidence:** quote the assertion, or quote its absence. For over-testing, list the duplicate tests.

**Grade:** a test that vouches for broken code is a **`blocker`** — it is not a weak test, it is a
disabled detector, and everything downstream trusts it. Over-testing and scaffolding tests are `debt`.
Missing proof is `debt`, and `blocker` where row 1 of `skills/run/test-strategy-spec.md` § 2 applies
(data loss, money, authentication, permission, secrets, anything irreversible, a consumed contract).

**Licensed explicitly: propose deleting a test.** A test with no behaviour behind it should go, and
the fix line should say `delete`. Nothing else in the loop will ever say it.

**Out of scope:** coverage percentage as a target. Coverage locates un-run code; it never shows that a
test means anything, and a dimension aimed at a number produces tests written to move the number.

### E · Security

**Asks:** what does it cost if this is wrong, and what is reachable from an untrusted input?

**Sweeps — access and input**
1. **Authorization coverage** — walk the route / handler / command table and list the **unguarded**
   ones. Inconsistency between neighbours is the tell, not absence in general.
2. **Object-level authorization** — does each handler check the resource belongs to the caller, or
   only that *someone* is signed in?
3. **Input validation at trust boundaries** — HTTP, CLI arguments, files, queues, environment.
4. **Injection** — SQL, command, path traversal, template.
5. **Crypto and randomness** — non-cryptographic randomness for tokens, ids or salts; home-rolled
   primitives.
6. **Transport and browser surface** *(web only)* — cookie flags, CORS, redirect handling.

**Sweeps — secrets and credential disclosure**

Run these even where the rest of `E` is thin. A leaked credential is the one finding in this spec that
is **already an incident** rather than a risk, and it is the cheapest of all to detect.

7. **In the source** — hardcoded keys, tokens, passwords, connection strings carrying credentials.
   Pattern and entropy: provider prefixes (`AKIA…`), `BEGIN … PRIVATE KEY`, `password =`, `Bearer …`,
   `postgres://user:pass@…`.
8. **Files that should never be tracked** — `git ls-files` for `.env*`, `*.pem`, `*.key`, `*.p12`,
   `credentials*`, service-account JSON; **and, separately**, whether `.gitignore` actually covers
   them. Both halves matter, and the common case is ignored-*and*-tracked: the ignore rule was added
   after the commit, so it silences the warning without removing the file.
9. **Still in history** — `git log --diff-filter=D --name-only` over the same patterns, plus any
   credential removed from a file that survives. A secret deleted from `HEAD` is in every clone
   forever. **The fix begins with rotation**; deleting the line is the second step, never the first.
10. **Reaching the client** — secret-shaped values behind `NEXT_PUBLIC_`, `VITE_`, `REACT_APP_` or any
    prefix the bundler inlines; keys compiled into a mobile or desktop artifact. The prefix says
    public; the value does not.
11. **In logs and telemetry** — logging a whole request, header set, config or environment object
    (`console.log(process.env)`, dumping `Authorization`), or shipping either to an error tracker.
12. **In responses** — stack traces, connection strings or config echoed to a user in an error body.
    The same leak is also a `G` sweep 7 finding; raise it here, cross-reference there.
13. **Sample and fixture files** — `.env.example`, seeds, fixtures and documentation holding a real
    value where a placeholder belongs.
14. **Environment sprawl** — `process.env.X` read from a dozen places rather than one validated
    module, so nobody can enumerate which secrets the system even has. Pairs with `G` sweep 14.

**Evidence:** the unguarded handler, named, beside a guarded neighbour. For a secret: `file:line`, the
**kind** of credential, and how it is reachable — **never the value, not once.** The report is a
tracked file in the repository, so a report that copies a key out of a `.gitignore`d file has
published the secret rather than found it. The same rule binds the issue filed from the finding, the
ledger, and anything said in the walkthrough.

**Grade:** a live credential in a tracked file, in history, or in a shipped client artifact is a
**`blocker`**, never capped, and its fix line begins with **rotate**. Anything else reachable from an
untrusted input is `blocker`; the rest is `debt`.

**Out of scope:** dependency CVEs unless the profile holds a command that reports them — then run it
and cite it, never guess a version's status. Compliance and licensing. Infrastructure the repository
does not contain.

### F · Resource & concurrency

**Asks:** what goes wrong *inside* the process, under load or over time?

**Sweeps**
1. **Lifecycle** — acquire / release / teardown, leaks, use-after-close.
2. **Unbounded growth** — caches with no eviction, queues with no cap, logs with no rotation, per-request
   accumulation into process-lifetime state.
3. **Shared mutable state and ordering** — races; steps whose correctness depends on a sequence nothing
   enforces; assumptions that hold only single-threaded.
4. **Structural performance cliffs** — N+1 queries, whole-table loads, unbounded pagination,
   synchronous work on a hot path.

**Evidence:** the shared handle, the missing bound, the query inside the loop.

**Grade:** `debt`, unless the hazard is reachable in normal operation — then `blocker`.

**Out of scope:** speculative optimization, micro-benchmarks, and any performance finding without a
named structural cause. A guess about what might be slow is the same defect as an abstraction built
for a caller that does not exist.

### G · Failure architecture

**Asks:** when something goes wrong, does the system do a decided thing?

Failure is the archetypal victim of accumulation. No issue owns it, every issue handles its own errors
locally and plausibly, and the system-level result is five policies nobody chose. Audited in three
tiers, because the tiers route differently: **policy** → `/devloop:architect`, **mechanism** → issues,
**proof** → test-repair issues.

**Tier 1 · Policy — is there one, and is it one?**

Almost no project has written this down, so the first job is to **reconstruct the de facto policy** —
walk each entry point and record what actually happens to a failure at each layer — and then judge
**coherence**, not correctness. Where no policy is stated and the code holds several, the finding is
`unowned`, and it reads like this:

> No stated failure policy. The code holds four: HTTP handlers return 200 with `{error: null}`
> (`api/handler.ts:40`), the job consumer lets the exception kill the worker (`jobs/run.ts:12`), the
> data layer returns `[]` on connection failure (`db/query.ts:88`), the CLI prints a stack trace
> (`cli/main.ts:6`). → `/devloop:architect`, then an ADR.

That handoff is the point of the dimension. Once the policy is an ADR it is **binding**, and the
`reviewer`'s design-conformance dimension enforces it on every diff from then on — so the audit does
not merely price the debt, it closes the gap that let the debt accumulate.

The taxonomy any such policy has to settle, and the sweep checks each failure site against it:

| Class | Correct treatment | The finding when it is wrong |
|---|---|---|
| **Expected / operational** — invalid input, not found, 429 / 503, a network blip | modeled as a value or a typed error; handled; reported | killing the process because one request had bad input |
| **Invariant violation** — impossible null, corrupt state, required config missing at startup | **fail fast, fail loud** | swallowed, so corrupt state spreads silently. The worst finding in this dimension |

**Tier 2 · Mechanism — the sweeps**

1. **Failure turned into a legitimate value** — a `catch` whose body returns `null`, `[]`, `false` or
   `0` without rethrowing or signalling. The caller then cannot tell *no rows* from *the database is
   down*. Highest-signal sweep in the whole audit.
2. **Handled where nothing can be decided** — catch-and-rethrow-unchanged; catch-log-rethrow (double
   logging); a catch-all at a low layer instead of at a boundary. Every finding **names the layer that
   should own it**: the nearest one holding a decision — retry, substitute, tell the user, abort.
3. **No boundary handler at all** — the HTTP handler, CLI `main`, job consumer or event loop with no
   catch-all, so an unexpected error escapes as a stack trace to a user or kills a worker. Missed more
   often than the over-catching above.
4. **Cause dropped on rethrow** — `throw new Error(msg)` with no `cause`, `raise X` with no `from e`,
   `fmt.Errorf` with no `%w`, `new X(msg)` with no `(msg, e)`.
5. **Context dropped in the message** — "failed to save" where "failed to save user id=42 to
   `accounts`" was available at the throw site.
6. **No error identity** — callers cannot distinguish failure kinds programmatically. String-matching
   on an error message (`if (msg.includes("not found"))`) is near-proof that propagation was never
   designed.
7. **Boundary translation, both directions** — internals leaking raw to users (stack traces, SQL,
   filesystem paths — also an `E` finding), or everything flattened to "something went wrong" with no
   correlation id, so nothing can be debugged afterwards.
8. **Fire-and-forget** — unawaited promises, floating async calls, background tasks and goroutines
   whose failure nobody observes. Failure that cannot be seen at all.
9. **Retry stacking** — count the retry mechanisms on **one** call path. Three layers of three retries
   is twenty-seven calls and a thundering herd; each layer was reasonable alone, which is why only a
   whole-path sweep finds it. Also: retry with no timeout (unbounded), retry on a non-retryable error
   (a 400 forever), no retry on a genuinely transient one.
10. **Fallbacks that mask** — a default that hides a dependency being dead for three weeks. A fallback
    must be **observable** — a metric, a log at the right level — or it is a silent failure with extra
    steps.
11. **Partial failure and atomicity** — multi-step operations that can fail halfway: writes to two
    stores with no transaction and no compensation. Does the system end up half-written, and does
    forward-then-back-then-forward restore the prior state?
12. **Idempotency** on anything retryable or replayable.
13. **Observability of failure** — a handled-and-recovered failure logged at ERROR spams the alerts
    until people mute them; a real outage logged at debug is invisible. Both are the same finding:
    the level does not match the decision. Check for correlation ids across boundaries.
14. **Startup validation** — required configuration not checked at startup, surfacing hours later as a
    mystery failure. The fail-fast rule applied to the one moment it is cheapest to obey.

**Tier 3 · Proof — does anything test the error paths?**

1. **Ratio** — per module, tests asserting failure behaviour against tests asserting the happy path.
   Near zero is the finding.
2. **Reach** — for each `catch` block and error branch in production code, does any test reach it?
   Mechanical where coverage was run (§ 3.2); otherwise read the branch and grep for a test that could
   enter it.
3. **`toThrow()` with no type, message or cause assertion is barely a test** — it passes when the
   function throws for the wrong reason, a typo raising `TypeError` included.
4. **Which failures are simulated at all** — usually only invalid input, the cheapest one. Timeouts,
   partial writes, malformed responses, a dependency down, a disk full: typically never.
5. **Consequence, not type** — does the test assert what the *system* does (state unchanged, user sees
   X, retried N times, alert emitted), or only that an exception of some class came out?

**Evidence:** the catch body quoted; the retry count per path; the assertion quoted, or its absence.

**Grade:** a swallowed invariant violation is a `blocker`. An unobservable fire-and-forget failure on
a path that matters is a `blocker`. Incoherence with no stated policy is `unowned`. The rest is `debt`.

**Out of scope:** designing the policy. This dimension reports what the code does and whether it agrees
with itself; choosing the rule is a human decision, made in `/devloop:architect` and recorded as an
ADR.

### H · Data & state

**Asks:** does the persistent shape of the system still match what the system means?

State is the one thing that cannot be refactored cheaply later: a wrong abstraction costs a day, a
schema with two sources of truth costs a migration and a reconciliation script. It is also the
dimension with the **weakest mechanical evidence** — the truth is spread across migrations, ORM models
and raw SQL — so the leash is tighter here than anywhere else: **an `H` finding must anchor two
concrete locations.** The field and its reader; the two sources that can legally disagree; the schema
word and the service word. One anchor is an impression.

**Sweeps**
1. **Two sources of truth** for one fact — a denormalized copy with nothing keeping it in step.
2. **Written and never read** — fields, columns and tables no code path reads.
3. **Migration reproducibility** — does the migration history still build the current schema from
   nothing? Are there irreversible steps with no note saying so?
4. **Word drift** — a domain term meaning one thing in the schema and another in the service.

**Grade:** `debt`. `blocker` where the two sources can disagree in a way that loses or corrupts data.

**Out of scope:** schema design opinions — normalization taste, index tuning, type width. Bring a
genuine structural problem or nothing.

### I · Record vs reality

**Asks:** is anything claiming to be true that is not?

Two halves, one method: **read a claim, trace it to the running code.** The product's claims and
devloop's own ledgers fail the same way and are found by the same sweep, which is why they are one
dimension.

**The product's claims**
1. **Unfinished work presented as finished** — stubs and hardcoded returns that look computed; a
   function returning fixed data as though it derived it. The most dangerous drift in AI-written code:
   the `reviewer` sees it only in the diff where someone said "fill it in later", and nothing revisits
   it after that.
2. **Scaffolding still shipping** — generated boilerplate never deleted, placeholder screens, sample
   or demo data reachable in production, `not implemented` reachable from a user path.
3. **Flags permanently off** — a feature built, merged, described as shipped, and unreachable.
4. **Closed acceptance criteria with no live code path** — take the acceptance criteria of closed
   issues and trace each to **running code**, not to a test. A green test proves the artifact works; it
   proves nothing about whether the system uses it.

**devloop's ledgers**
5. **`.context/devloop-baseline.md`** — entries whose tracking issue is closed, or that have been
   accepted-failing for several sprints.
6. **`.context/devloop-unproven.md`** — open rows nobody ever picked up.
7. **ADRs** — for each decision in `.context/decisions/`, does the code still obey it? Declared
   binding at the moment it was written, and nothing in the loop has re-read it since.
8. **Docs drift** — **cite `.context/docs-audit.md`**, do not recompute it. If it is missing or stale,
   say so and recommend `/devloop:docs`; re-implementing another skill's audit inside this one is how
   two answers to one question start disagreeing.

**Evidence:** the claim quoted with its source, beside the code that contradicts it.

**Grade:** `blocker` when a closed acceptance criterion has no live path, or a stub is reachable from
a user path — the record says the feature exists and it does not. Otherwise `debt`.

**Out of scope:** rewriting the documents. This dimension reports the gap; `/devloop:docs` closes it.

---

## 5. Budget — bounded depth, never bounded coverage

Every applicable dimension is always swept. What is capped is how much of it reaches the report.

- **Rank by cost × severity**, then cap `debt` and `note` per dimension — five is a sane default.
- **Never cap `blocker`.** A cap that can hide a reachable security defect is not a budget, it is a
  bug in the audit.
- **A firing cap must be visible**, with its count: `capped — 5 shown, 11 more of this kind`.
  Suppression the reader cannot see is the audit committing the exact offence it was sent to find.
- **Bundle at filing time, not at finding time.** Fourteen dead symbols are fourteen findings and
  **one** issue, carrying the callers-grep for each. Fourteen issues drown the backlog and the audit
  gets switched off.

---

## 6. Verdicts and trend

**Per dimension** — `healthy` · `debt` · `broken`, each with a one-line justification **citing the
sweep**, so `healthy` cannot be a shrug.

**The headline is the test-trust question:** *is this suite trustworthy enough to refactor behind?*
It goes first, before any finding, because the order of every remediation depends on the answer. If
the detector is broken, structural work that hides behind it is not safe to schedule yet.

**Trend**, from the second audit onward. Report only what is defensible: **counts by dimension ×
grade**, plus two explicit lists — **resolved since last audit** (findings whose issues are now closed)
and **carried** (still open). Do not diff finding-by-finding: identity is content-based
(dimension + file + symbol) and churns the moment a file moves, and a fabricated "12 → 9" is worse
than no trend at all.

---

## 7. The report

One file per audit, kept: `.context/audits/YYYY-MM-DD.md`. History is what makes § 6 possible.

```markdown
# Audit — YYYY-MM-DD

**Commit:** <sha>  ·  **Scope:** whole repository | <path>  ·  **Instruments:** coverage ✓ · lint ✓

## Verdict
**Can you refactor behind this suite?** yes | not yet — [one line]

| Dimension | Verdict | Findings | Capped |
|---|---|---|---|
| A · design & YAGNI | debt | 3 blocker · 7 debt | 4 more |
| …

## Decisions needed before work          ← `unowned`, max 3, ordered by what each unblocks
### U-1 · [the concern] — no stated policy
[the reconstructed policies, each anchored] → `/devloop:architect`

## Blockers
### [id] · [dimension] · [anchor] · cost: [band]
[claim] — [evidence] → [fix]

## Debt
## Notes
## Swept clean                           ← the manifest, § 3.3
## Not applicable                        ← dimension + reason, § 3.1
## Trend                                 ← second audit onward, § 6
## Where the loop leaked                 ← max 3 lines, § 9
## Remediation order                     ← § 8
```

---

## 8. Routing — the audit files, it never fixes

| Finding | Destination | Why there |
|---|---|---|
| `blocker` | `/devloop:replan` → the active sprint | it should not wait for the next planning cycle |
| `unowned` | `/devloop:architect` → an ADR | nothing can be scoped until the rule exists |
| a coherent cluster | issues, and **say it is a sprint** — the human runs `/devloop:plan` | `plan` owns milestones; the audit never creates one |
| everything else | backlog issues, `type:backlog` + `source:audit` | `plan`'s triage surfaces them like `devloop-unproven.md` rows |
| accept and leave | the ledger, below | so the next audit does not raise it again |

**Remediation order, and it is not negotiable:**

```
decide the unowned rules  →  restore the detector  →  remove the unsafe  →  simplify
```

Refactoring toward a policy nobody has chosen is churn; refactoring behind a suite that cannot fail is
a bet. Structural work is last because it is the only step whose safety comes entirely from the two
steps before it.

**Every filed issue cites the audit** — `Source: audit YYYY-MM-DD, finding G-3` — with the claim, the
evidence and the fix copied in. An issue that says "from the audit" and nothing else sends the `coder`
back to re-derive a finding that was already proven once.

**The ledger** — `.context/devloop-audit-accepted.md`, the won't-fix record, in the shape of
`devloop-baseline.md`:

```markdown
## G-3 · failure · api/handler.ts:40 — 200 with {error: null} on a handled failure
- accepted: 2026-09-16
- why: the mobile client parses this shape; changing it is a client release
- reopen when: the client ships v3, or a second handler copies the pattern
```

Without this, every audit re-raises the same forty things and the user learns to stop reading. A
`reopen when:` is required — an acceptance with no condition is a decision nobody can revisit.

---

## 9. Where the loop leaked

The audit is the only pass that sees what escaped **every** gate, so each cluster may carry one line
naming the check that should have caught it: *"nothing in the loop re-greps callers when a symbol
loses its last one"*; *"acceptance criteria only ever state happy paths, so the test plan was never
asked for failure behaviour"*.

Fenced, because `/devloop:review` already holds the house rule — **speak about the project, not about
devloop** — and this section is where that rule breaks first:

- **Report only. Never in the walkthrough conversation.**
- **Max three lines**, and only where a *named* gate is the answer.
- Phrased as *nothing in the loop looks for X*, never as a complaint about the tooling.
- **Never a mitigation.** "The loop let it through" does not soften a finding by one grade.

---

## 10. The stop rule — the walkthrough has to end

A forty-finding report cannot be walked item by item. The human gate becomes a ninety-minute meeting,
gets skipped, and the unreadable wall has simply arrived one step later.

1. **Every `blocker`, individually.** No exceptions, no batching.
2. **Every `unowned`, individually** — at most three, and each is a decision, not a fix.
3. **The top `debt` by cost × severity, individually** — five is a sane default.
4. **Everything else, batch-decided**: *"file the remaining 14 `C` findings as one bundle? y/n"*.

---

## 11. Never

- Never write production code, tests, or a migration. The audit reads and reports; `run` changes code.
- Never take `.context/sprints/state/.lock`, and never wait for it. Read-only work does not queue.
- Never file an issue, open a PR, or write the ledger without the human gate.
- Never raise a finding with no sweep result behind it, or with no named edit in the fix.
- Never cap, drop, or downgrade a `blocker` — not for budget, not for cost, not for the loop.
- Never let a green suite argue a finding down. The tests are the subject, not the authority.
- Never invent a policy for the code to conform to. No stated rule means `unowned`, not a preference.
- Never mark a dimension clean without showing what was swept.
- Never re-raise a finding that sits in `.context/devloop-audit-accepted.md` with its condition unmet.
- Never quote a secret's value — not in the report, an issue, the ledger, or the walkthrough. The
  `file:line` and the kind of credential, never the value: the report is a tracked file.
- Never propose deleting a leaked credential without **rotate** as the first step of the fix.
- Never raise coupling, cohesion or SRP as an adjective. No count, no tally, no named move, no finding.
- Never recompute another skill's audit — cite `.context/docs-audit.md` and move on.
