# ba-spec — the discovery conversation

The single source of truth for **how devloop finds out what a product is**, and what the record of
that looks like. Read and *enacted inline* by `/devloop:vibe` (before it plans anything) and
`/devloop:roadmap` (when the conversation has no vision in it yet). There is no `/devloop:brief`
command — this is a shared contract between two skills, exactly as `plan-spec.md` is shared by
`plan` and `replan`, so the two can never drift.

**It is enacted by a skill, never by a subagent.** The whole thing is a conversation with the human,
and agents in this plugin do not talk to the user. The one agent involved is `ba-critic`, which is
mute: it reads a drafted brief and reports what is not checkable.

---

## 1. What it produces

`.context/product-brief.md` — a **shared project record**, at `.context/` level beside
`devloop-profile.md` and `decisions/`. Not owned by `vibe`. Every skill and every agent may read it;
`vibe` and `roadmap` are the only writers.

It is **free of technology**, on purpose. No stack, no storage, no framework, no file paths. The
moment a technical noun appears the document stops being the user's and becomes ours, and the user
stops correcting it. Technical decisions live in `vibe.md` (`vibe`) or an ADR (`architect`).

---

## 2. The problem this format exists to solve

A conversation produces agreement **in the moment**. Then the context dies, and what survives is our
summary of it — a self-report, which a later replay cannot catch a self-consistent error in.

Worse: **prose does not fail.** A paragraph describing a product reads as correct to both parties
while each pictures something different. The user has no way to notice, and no way to say so without
admitting they lost the thread — so they say "yes, that's right", and everything built afterwards is
built on a shared picture that was never shared.

So the format is chosen entirely for **where a mismatch becomes visible**. Every section below earns
its place by being something a person can say a flat *no* to.

---

## 3. The brief

```markdown
# [Product name] — product brief

**Written:** YYYY-MM-DD · **Last confirmed:** YYYY-MM-DD

## In one sentence
[What it is and who it is for. Plain. No adjectives that could describe anything.]

## Words we're using
- **[noun]** — [what it means *here*, in the user's own words]

## Who uses it
- **[Name], [what they do]** — [when and where they touch this]

## One day in the life
[A single scenario, start to finish, concrete: one person, one occasion, one outcome.]

## What it does
- [capability, one line each]

## What it does NOT do
- [exclusion, one line each]

## Shape
[ASCII sketch — screens and the path between them. Every box glossed below it.]

## Still guessing
- ⚑ [something drafted rather than told to us]
```

**Why each section is there** — this is not decoration, and a section dropped for brevity takes its
detection with it:

| Section | What it catches |
|---|---|
| **Words we're using** | The misunderstanding almost always hides in a noun. They said "booking" and meant something specific. Three to six terms; more than that and nobody reads it. |
| **Who uses it** | A *role* is un-disagreeable ("users manage inventory" — sure). A named person doing a thing at a time is checkable. |
| **One day in the life** | Where they say *"wait — not on the phone"*. No amount of feature-listing surfaces that. |
| **What it does NOT do** | Far more falsifiable than the inclusion list, and the section most briefs omit. This is where "wait, no!" lives. |
| **Shape** | A structure written as prose has to be reassembled in the reader's head. Draw it, gloss every box. |
| **Still guessing** | Tells them where to look. A brief with no ⚑ after one short conversation is not confident, it is unverified. |

**The nouns pay for themselves twice.** They are the product's vocabulary, so they become the code's
vocabulary — `vibe` passes them to the `coder` in its per-iteration context, and the app's internals
end up speaking the user's language instead of ours.

---

## 4. The method

### Draft early and let them shoot at it

The failure mode of discovery is **interrogation**: twenty questions before anything exists, and a
non-technical user gives up or starts guessing at answers to be helpful. The fix is not fewer
questions. It is changing what you hand them.

People are far better at **correcting a wrong concrete thing** than at authoring from blank.

So: ask **two or three** questions — no more — then write the **whole brief**, inventing every
specific you do not have, and hand it over marked up:

> I've written down what I think we're building. The ⚑ ones I guessed at.
> Which are wrong?

That inverts the exchange from extraction (exhausting, and they do not yet know the answers) into
correction (fast, and it surfaces things they would never have thought to volunteer). `roadmap`
already uses `⚑` this way on a Demo line drafted from a goal — same convention, same reason.

### The opening questions

Three, at most, and they are all product questions:

1. What are you trying to build, in your own words?
2. Who is it for, and when would they use it?
3. What would make it a success for you?

Everything else gets **drafted and corrected**, never asked.

### The correction loop

Show the brief. Take their corrections. Rewrite it whole and show it again — never a list of
diffs on a document they have not internalised yet. Repeat until they stop correcting.

**One thing per message** and **make being lost free**: *"if any of this reads like I've misunderstood,
say so — it is much cheaper to fix here than after we've built it."* A user who cannot cheaply say
"I'm lost" keeps nodding, and every later confirmation is worth less than it looks.

### Follow the user's language

Talk to them in whatever language they are writing in. The **brief on disk stays in the repo's
language**, with their exact words preserved in *Words we're using* — those are data, not prose.

---

## 5. `ba-critic` — the check on a comfortable conversation

Before showing a brief for the first time, and before writing an amended one, invoke the **`ba-critic`**
agent on the draft. It is mute — it never speaks to the user. It returns what is vague, unfalsifiable,
or missing: an unchecked capability, an undefined noun, an absent NOT list.

Read its findings and turn them into the next question. Do **not** paste them at the user — they are
written agent-to-agent, and half of them you can just fix.

A comfortable conversation produces a comfortable brief. This is what stops that being the last word.

---

## 6. Confirming, and amending later

**Confirmation is explicit.** *"Have I got this right?"* — and a yes writes the file with
`Last confirmed:` set to today. A question, a "looks fine I guess", or more discussion is not a yes.

**A brief goes stale, and that is the expected case, not a failure.** The user learns what they want
by seeing the thing run; our model of it quietly becomes the code. By the fourth iteration the brief
says one thing and the app does another, and nobody noticed because nobody re-read it.

So when a caller re-enacts this spec against an existing brief:

- Read the current brief first and **say what it currently claims** before proposing anything.
- **Show the diff** — what changed, in plain language, side by side. The drift case is the common one,
  and a user who cannot see what changed cannot confirm it.
- Rewrite the file whole and update `Last confirmed:`.
- Never silently drop a *What it does NOT do* line. An exclusion being lifted is a real product
  decision and gets said out loud.

---

## 7. Rules a caller restates at its own write site

These are prohibitions, so they live where the writing actually happens, not only here:

- **Never ask a technical question.** No stack, no storage, no framework, no hosting. If a technical
  choice needs deciding, find the *product* question that decides it and ask that instead — the
  answer, the decision it drives, and its rationale belong to the calling skill, not to the brief.
- **Never invent a fact and present it as theirs.** Every drafted specific carries `⚑` until they
  confirm it. An unmarked guess is indistinguishable from something they told us, which makes the
  whole document untrustworthy the first time one is caught.
- **Never present a menu.** One drafted brief, taken as a proposal. "Here are three directions we
  could go" hands the decision back to the person who came to us because they could not make it.
- **Never write the brief without an explicit yes.**
