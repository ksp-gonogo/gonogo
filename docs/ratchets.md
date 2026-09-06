# Ratchets: how this codebase stops regressions coming back

A **ratchet** is a test whose job is not to check that the code works, but to check
that a _category of mistake_ is not getting more common. It turns a rule people keep
meaning to follow into one the build enforces. And here is the part that makes it a
ratchet rather than merely a rule: it lets you adopt that rule while the codebase
still breaks it in a hundred places.

You write down the hundred. The gate fails if the number goes up. You delete entries
as you fix them. It only turns one way.

This document describes the shapes we ended up with, why each exists, and what we got
wrong first. Everything below the next section is written to be lifted into another
project. The next section is not: it names this repo's paths and commands, because a
red build is when most people open this page and an essay is no use to them.

---

## Start here if one just failed

### Where they are

- **The gates**: `packages/core/src/*.test.ts`. 67 of them scan outside their own
  package, and they live in `@ksp-gonogo/core` whatever they police (the reasoning is
  under "Where a ratchet lives"). Which files those are is derived, not listed:
  `packages/core/scan-tests.mjs` picks out the ones that reach outside the package
- **Their debt lists**: beside them, as `packages/core/src/<subject>.allowlist.ts` or
  `<subject>.debt.ts`. `RATCHET_ALLOWLIST_PATHS` in `packages/core/src/ratchetBaseRef.ts`
  enumerates every list that is graded against a base revision
- **Numeric budgets** are usually a constant inside the gate file itself, not a
  separate list: `MAGNITUDE_BUDGET` in
  `packages/core/src/styleguide-magnitude-budget.test.ts` is the model
- **The gates that cannot be tests** are in `scripts/`, each with its data beside it:
  `scripts/act-warning-gate.mjs` + `scripts/act-warning-debt.mjs`,
  `scripts/uplink-shape-gate.mjs` + `scripts/uplink-shape-debt.mjs`. The census and
  regeneration tools for the test-hosted gates live there too
  (`scripts/panel-body-debt.mjs`, `scripts/comment-stack-debt.mjs`,
  `scripts/unknown-cast-debt.mjs`)

### How to run one

```bash
pnpm --filter @ksp-gonogo/core test:scans      # every cross-package ratchet
pnpm act-warning-gate                          # the standalone act-warning gate

# one gate, after `pnpm build` once (the suite needs the workspace's dists):
pnpm --filter @ksp-gonogo/core exec vitest run \
  --config vitest.scans.config.ts src/styleguide-panel-body.test.ts
```

`turbo run test` is a smaller task set and does not reach these. **Commit first, then
re-run**: several of these scans enumerate with `git ls-files` or `git grep`, so an
untracked file is invisible to them, and the set of gates that runs at all is itself
derived from `git ls-files`.

### What the failure is telling you

The category decides the remedy, and they differ sharply. You do not have to know
which category a gate is in beforehand: its failure text says. Match on what you were
just printed.

| The failure says                                                                  | Category                            | Do this                                                                                                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| violations named one by one, each with its file and line, absent from a list      | 1, shrink-only list                 | **Fix the code.** The list may only lose entries. Adding one is the move the gate exists to refuse                                                    |
| a count over a number: `exceeds baseline (N) by M`, `used, budget N`, `not on the list` | 2, numeric, over arm           | Fix the code. A raise is last resort and has to name the API method that would have avoided it (see "A budget entry is often a missing API")           |
| `is down to N and the baseline still reads M`, `sit above what their file uses`   | 2, numeric, shrink arm              | You improved something. Retype the figure the message prints, in the file it names, in the same commit. The walk past the note above it is the point   |
| a diff against a committed artefact                                                | 3, snapshot                         | Decide whether the change was intended, then regenerate by the sanctioned route the failure names, never by hand                                       |
| `declared but unknown`, `known but no longer declared`                             | 4, two-sided sync                   | There is no debt list to move. One side is stale: make the two equal                                                                                  |
| `BLIND: ...`, `found no ... at all`, a planted violation that was not seen             | 7, self-verification                | The instrument, not your change. Leave every debt list alone and fix the scan                                                                          |
| anything prefixed `[ratchet]`                                                      | the apparatus                       | Not your change either. See "The base revision" below                                                                                                 |

### Ceiling or equality: ask the tree, not a list

A numeric gate is a **ceiling** (over fails, under passes and is reported) or an
**equality** (either side fails). Which one it should be is decided by one question
you can answer for any gate in a minute: **run it twice on an unchanged tree.** A
count produced by scanning text is the same number both times and should be an
equality; a count observed from a run, warnings emitted or events seen, moves with
machine load and has to be a ceiling. `act-warning-gate` is the second kind.
`styleguide-styled-components`, `styleguide-magnitude-budget` and
`styleguide-fire-and-forget-commands` are the first, and are equalities: if your fix
lowers one of them, it stays red until you retype the number, and the failure prints
the exact figure and the file to put it in.

**On a ceiling over a race, a growth red is real even if it does not reproduce.**
Contention does not invent the race, it gives it more chances to fire, so the high
reading is the true one and the low one is not evidence you fixed anything. Re-running
until it goes green is how a gate loses its grip. The act gate prints the machine load
beside the count so the two readings can be compared honestly.

### Regenerating a list

Some lists have a tool, some deliberately do not.

| List                                       | Regenerate with                                            |
| ------------------------------------------ | ---------------------------------------------------------- |
| `scripts/act-warning-debt.mjs`             | `pnpm act-warning-gate --update --only <substring>`         |
| `packages/core/src/panel-body.allowlist.ts` | `node scripts/panel-body-debt.mjs --update`                 |
| `packages/core/src/comment-stacks.allowlist.ts` | `node scripts/comment-stack-debt.mjs --update`         |
| `packages/core/src/unknown-cast.debt.ts`   | `node scripts/unknown-cast-debt.mjs --update`               |
| `PROSE_DEBT` in `scripts/asyncapi/prose-hygiene.mjs` | `node scripts/asyncapi-doc.mjs --update-prose-debt` |
| the three equality gates above             | nothing. By hand, which is the design (see category 2)              |

The four `--update` tools that rewrite a shrink-only list rewrite the whole of it, and
that is safe for them: the gate refuses a list that grew, so a bare run cannot launder
a new violation into the baseline. The act gate is the exception, because its numbers
are a race rather than a census, and rewriting all of it from one roll writes down that
run's number for files your change never touched, inside a commit that says it fixed
something else. So `pnpm act-warning-gate --update` **refuses** without a scope, before
it measures anything: `--only <substring>` names what you fixed, `--all` is the
deliberate spelling for a full reseed.

### The base revision

Any failure whose message begins `[ratchet]` is the measuring apparatus, not your
change, and no debt list should move because of it. They all come from
`packages/core/src/ratchetBaseRef.ts`, and these are the two you will meet:

- `[ratchet] base revision unreachable: ...`: nothing to grade against. Locally,
  `git fetch origin staging`, or set `RATCHET_BASE_REF=<commit>` yourself. In CI, the
  checkout needs `fetch-depth: 0` and the "Resolve the ratchets' base revision" step
- `[ratchet] the base revision <ref> IS the commit under test`: the base resolved to
  HEAD, so every list would be diffed against itself. `scripts/resolve-ratchet-base-ref.sh`
  works the right one out per trigger

`RATCHET_BASE_REF` is the supported override and CI sets it from that script; note
that `packages/core/turbo.json` has to declare it under `env` or turbo passes nothing
through and the gates fall back. What was wrong in the story below is not the variable,
it is having defaulted it silently.

---

## Why we have so many of them

Almost every ratchet here was born the same way: **something reported success while
being structurally incapable of reporting failure.**

The clearest case is `act()` warnings in React tests. The house rule was "an act
warning is always our bug", and everyone believed the tree was clean. It was carrying
104 of them. The reason is dull and complete: our test runner suppresses console
output for tests that _pass_, and an act warning does not fail the test that emits it.
So the normal command printed none of them, and always had. The number people quoted
in status updates was 19, arrived at by a measurement nobody could reproduce.

That is the pattern the whole collection defends against. Not "the code is wrong" but
"the thing you are asking has no way to say no".

Once you start looking, the shape recurs: a build that skips a project and reports
zero warnings, a cache that reports hits as passes, a search whose pattern cannot
match what it is hunting, a shell pipeline that swallows a non-zero exit code, a join
that drops most of one side and reports the remainder as absence. Each one produces a
confident green.

So the rule this codebase runs on is:

> **A green is not a result until you can name the check that produced it and say
> what failure it was capable of seeing.**

A ratchet is how you make that check exist, and keep it existing.

---

## Where a ratchet lives

Before the categories, the mechanism, because "write a ratchet" is not obvious until
you know what it physically is.

### The default host is an ordinary test

Nearly all of ours are plain test files sitting beside the unit tests, picked up by
the normal test command. That is the whole point: **a ratchet that needs its own
invocation is one people forget.** Because it is just a test, the pre-push hook and CI
run it with no extra wiring, a failure looks like any other failing test, and nobody
has to know it is special.

**Why a test rather than a lint rule.** Lint rules see one file at a time. A ratchet
needs whole-tree facts: every file that imports X, the total count across a package,
what this same list looked like on the base branch. A test can walk the filesystem,
shell out to git, read another revision, and compare. Most of ours could not be
expressed as a lint rule at all.

### They live in one package, not in the packages they police

We have 67 of them, all in `packages/core/src` (the `@ksp-gonogo/core` package) rather
than distributed to the code they check. Two reasons, both learned:

- **A gate inside the thing it polices dies with it.** Delete or restructure the
  package and the rule silently goes with it. Housed centrally, the gate survives and
  fails loudly instead.
- **They need to see everything.** A cross-package rule cannot be enforced from inside
  one participant, and running the same scan once per package is both slower and
  ambiguous about which copy is authoritative.

The practical rule: the ratchet lives wherever it can see the whole subject.

### Data lives apart from logic

Each debt list is its **own module with no test logic in it**: just an exported
array. The shrink check needs to load that file's contents _at a different git
revision_, and if the list is embedded in the test, doing so drags the test framework
and the scanner along with it. Splitting them makes the shrink check a few lines.

### Getting the base revision right, which we did not

This is the part of the shape we got wrong for the whole life of these gates, and
it is worth more space than it looks like it deserves, because the failure was
invisible from every angle.

Each shrink check read its list at a base revision and diffed. The base was a
variable with a sensible-looking default:

```
const BASE_REF = process.env.RATCHET_BASE_REF ?? "origin/staging"   // WRONG, twice over
```

Nothing set that variable. And our CI checks out at depth 1, so `origin/staging`
did not exist in the clone at all. Every gate wrapped the read in a `try` that
returned `undefined` on failure, and every caller opened with "if there is no
base, return". So in CI the read failed, the check returned early, and the test
passed. Five ratchets, green on every run, having never once compared anything.
The only place they could fail was a developer's own machine.

Then the second half, which survives fixing the first: on a push to the branch
the default names, `origin/staging` **is the commit under test**. A file diffed
against itself reports "unchanged" forever. Fetching the ref would have bought a
gate that still could not fail.

Both halves generalise, and both are the same mistake in different clothes:

> **A base revision is not a constant. It is a function of the trigger, and a
> gate that cannot reach a usable one must fail, not skip.**

What we run now:

- one resolver, shared by every ratchet (`packages/core/src/ratchetBaseRef.ts`),
  that **throws** when no base can be reached and **throws** when the base turns
  out to be the commit under test. Neither condition can be expressed as a
  passing test, so neither can be mistaken for one. Both messages carry a
  `[ratchet]` prefix and say what to do, so an apparatus failure cannot be
  mistaken for a violation of your change either
- a CI step that works the base out per trigger and refuses rather than guessing
  (`scripts/resolve-ratchet-base-ref.sh`, run by the "Resolve the ratchets' base
  revision" step): the tip **before** the push (`github.event.before`) on a push,
  the branch's fork point on a pull request, never `origin/<the branch being
  pushed>`. It publishes the answer as `RATCHET_BASE_REF`
- a checkout at `fetch-depth: 0`, because at depth 1 there is no second revision
  to compare against
- `RATCHET_BASE_REF` declared under `env` in `packages/core/turbo.json`, because
  turbo passes through nothing it is not told about, and a variable it drops is a
  fallback nobody sees taken
- a separate test, `packages/core/src/ratchet-base-ref.test.ts`, whose only
  subject is the apparatus: did a base resolve, is it an ancestor of the checkout
  rather than the checkout itself, was every debt list actually readable there.
  None of the five gates can ask that about itself, which is the whole reason the
  blindness lasted

The last one is category 7 below applied to the machinery rather than to a scan,
and it is where the value is. Fixing the base ref makes the gates work; the guard
is what tells you when they stop working again.

**The variable survives; the silent default is what died.** `RATCHET_BASE_REF` is
still how CI hands the resolver its answer and still how you pin one locally
(`RATCHET_BASE_REF=<commit> pnpm --filter @ksp-gonogo/core test:scans`). The defect
was a fallback that could not fail, not the environment variable. With nothing set,
the resolver walks `origin/staging`, `origin/main`, `main`, takes the merge base of
the first that exists with HEAD, and throws if none of them do. It returns "no base"
in exactly one case, a local checkout sitting ON that merge base with nothing supplied,
where there is genuinely nothing to diff; on a runner that same case is a failure,
because there the base is supplied and being handed the subject is a config bug.

### When a test is the wrong host

Two of ours genuinely cannot be tests, and both taught the same lesson: **a check
cannot observe the thing it is running inside.**

**The act-warning gate has to run the test suites in order to read what they print**,
so it cannot live inside one of them. It is a standalone script with its own CI job.
It also cannot ride the normal test command, because the default reporter suppresses
the very output it needs, which is why the warnings were invisible for so long.

**Type errors cannot be caught by our tests at all**, because the test runner strips
types rather than checking them. So typecheck lives in a git hook instead. Before that
existed, type-only errors and formatting drift reached CI unchallenged.

If your candidate ratchet needs to observe the runner, the build, or the toolchain,
it needs a host outside them.

### Three enforcement points, doing different jobs

| Point      | Runs                                                                        | For                                                    |
| ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| pre-commit | formatter + typecheck                                                       | Fast, catches what the test runner structurally cannot |
| pre-push   | full test suite, browser tests skippable                                    | The real gate; everything above runs here              |
| CI         | the suite, plus matrixed browser and visual jobs, plus the standalone gates | Environment-specific work, and the authority of record |

A ratchet that only runs in CI is worse than one that runs locally, because the person
who broke it finds out long after they moved on, and cannot reproduce it.

The inverse bit us harder, and for longer. Our shrink-only gates ran ONLY locally,
not by design but because their base revision was unreachable on a runner, so CI
was "the authority of record" for a set of checks it was structurally unable to
run. Both statements in the table can be true at once and neither is worth much
on its own: what matters is whether the check could have failed where it ran. See
the base-revision section above for how that one went unnoticed.

### The escape hatch that will eat you

Ours has a list in the CI config of suites that run but do not block. It exists for
good reasons and it is where things go to die: one suite sat in it while carrying
thirteen real failures for a month, and two people independently misdiagnosed why
before anyone found the cause.

If you have such a list, **every entry needs a comment saying what would let it
leave**, and the list itself deserves a periodic look. An unexplained entry is a
regression with a hall pass.

### A budget entry is often a missing API, not a debt

Before raising any numeric budget, ask what method the thing being escaped is
missing. A count that goes up because the API cannot express something is an
**API gap**; the fix is to widen the API, and the budget then falls on its own.
A count that goes up because the API already had the method and nobody used it
is a **mistake**, and the fix is to use it. Neither is a debt to budget.

We learned this on `.magnitude`. `Value.isFinite()` was added specifically to
retire `Number.isFinite(x.magnitude)`, and its doc says so; a later file did the
exact thing it was built to replace and took a budget entry for it. `min`/`max`
take a bare operand for the same reason, after `Math.max(0, x.magnitude)` had
been written five times.

Only a genuine boundary earns an entry: a plain-number return type, a
third-party call, a wire shape you do not own.

**So bring an API change rather than a request to raise a ratchet.** The raise
is the last resort, not the first move, and a raise proposed without saying
which method would have avoided it has skipped the question.

---

## The categories

### 1. Debt lists (shrink-only)

The workhorse. A data file lists every current violation. The gate scans the tree,
compares against the list, and fails if anything appears that is not on it. A separate
check compares the list against the same file **on the base branch** and fails if it
has grown.

Used here for architectural boundaries, which packages a plugin may import, which
internal names may appear in published documentation, which reflected members have not
yet had their safety audited.

The important property is that adopting the rule costs nothing on day one. You seed
the list with reality, and the rule is live immediately for all _new_ code. Nobody has
to schedule a cleanup before the rule can start protecting you.

**A gate can be finished, correct, proven able to fail, and still not wired.** The
stacked-overlap gate (does a widget paint two of its own sections into the same pixels)
was written on 2026-08-26, complete with a self-check that plants a known-bad layout on
every run. It was then deliberately held OUT of CI, and the commit says why: one widget
was red, and a permanently-red step hides the next unrelated failure behind it, which is
what `visual` already does. Four days later the widget that blocked it was fixed for an
unrelated reason, a sweep of all 45 configured widgets came back clean, and the step went
in. Two things to take from that. A deferral with its blocker NAMED in the commit message
is recoverable, where "not wired yet" would not have been. And the detector was running in
CI the whole time, inside `visual`: what was missing was never the check, it was a green
job to report it in.

**This is about wiring a NEW gate, and it is not permission to un-wire a live one.**
The question there was whether a rule nobody had been held to yet should start blocking
on the day it landed, with a known-red widget in front of it. A gate that has been green
and just failed on your change is answering a different question, and taking it out of
CI deletes the only evidence of what you changed. The available moves are to fix the
code, or to argue in the open that the rule is wrong and change the rule; quieting the
gate is not one of them. Note also that the anecdote ends with the gate wired, not with
the deferral: what made the deferral survivable was a named blocker somebody could come
back and clear.

**A list with a real zero needs a floor that is not the debt.** Most of ours never
approach empty, so an instrument check floored on the population is safe. The
panel-body ratchet is meant to reach zero, and a floor under its population would be
one the work has to walk through: clearing the last widgets would trip the check, and
the shrink guard refuses to lower a floor, so finishing would mean fighting the gate.
It floors on files walked and on `<Panel>` tags found instead. Converting a widget
turns a body into a self-closing tag, so the tag count survives the work.

**What we learned:** put the list in its own module with no test logic in it, so the
shrink check can load the file's content at an arbitrary git revision without dragging
the test framework and the scanner along with it. We did not do this first and the
shrink check was painful until we did.

### 2. Numeric debt (per file, as a ceiling or an equality)

When violations are countable rather than nameable: warnings emitted, occurrences of
a pattern: the list holds a number per file rather than a name per violation.

Two rules here were both learned by getting them wrong:

**A ceiling if the count is a RACE, an equality if it is deterministic.** This was
written here as "a ceiling, never an equality" and the "never" was wrong, which cost
three gates most of their grip before anyone noticed.

Where it is right: some counts are races, and their true value moves between runs
depending on how loaded the machine is. One file measured 0, 1 and 21 across runs of an
unchanged tree. A gate that failed on any _downward_ move would go red on an untouched
branch on its own schedule, and people would learn to ignore it. `act-warning-gate` is
this kind and stays a ceiling: more than your entry fails, fewer is reported and passes.

Where it is wrong: a count produced by scanning text is the same number every time for
the same tree. There is no flake to protect against, and the "fewer is reported and
passes" half is then pure cost. **Slack in a shrink-only list does not catch the next
violation, it absorbs it.** A styled-components baseline of 71 against a live 41 was
not a record of anything; it was standing permission for thirty new imports, and the
over-baseline arm could not see them arriving because they fit. All three of
`styleguide-styled-components`, `styleguide-magnitude-budget` and
`styleguide-fire-and-forget-commands` had drifted this way (71/41, 329/294, 55/32), and
all three are now equalities.

**Which kind a gate is, is a property of its measurement, not a fact you have to look
up.** Run it twice on an unchanged tree: a census of text gives the same number and
wants an equality, an observation of a run does not and wants a ceiling. That test also
tells you what a red means. Under an equality your own fix leaves the gate red until you
retype the number, and the failure hands you the figure and the file. Under a ceiling a
growth red is a real sighting even when the next run comes in lower, because contention
gives a race more chances to fire rather than inventing one: re-running until it passes
is how a gate stops being believed.

**"Reported" has to mean reported to someone.** The reason nobody noticed is the
mechanism this whole document opens with, turned on itself: shrinkage was a
`console.warn`, vitest 4's default reporter suppresses console output for a test that
PASSES, and `pnpm test` and CI both run the default reporter. Measured with a baseline
planted 3 above live: exit 0, and not one character about the slack in the output. The
same gate under `--reporter=verbose` prints it fine, which is how we know the code path
was firing the whole time. The styled-components header records this nag going unheard
twice, thirty imports apart.

So the fix was to make the shrink FAIL rather than to make the warning louder. Any
louder-warning variant (stderr, a job-summary annotation) still rests on a person
reading it, which is precisely the step that did not happen, and it cannot be tested:
you can plant a shrink and assert a red build, you cannot plant one and assert that
somebody noticed.

**Per file, never one total.** A single number lets one file's improvement pay for
another file's regression. The total sits still while the codebase gets worse.

We also found it necessary to distinguish a number that was **measured** from one that
was **chosen**. An entry carrying an explanatory comment is never lowered
automatically by the regeneration tool, because a human picked it for a reason and a
fresh measurement would silently overwrite that reason.

**A regeneration tool has to be scoped to what you changed.** Rewriting a whole list
from one fresh measurement is a force-push for baselines: a commit about one widget's
fix also writes down that run's number for every entry it never touched, which is
unreadable in review and, on a race-y count, simply wrong. Where the gate refuses a
grown list a full rewrite is harmless, because a new violation cannot be laundered
through it. Where the count is an observation it is not, so `pnpm act-warning-gate
--update` refuses a bare run and makes you say `--only <substring>` or `--all`. The
listing under "Regenerating a list" above says which tool belongs to which list.

The three equality gates above honour that by having no regeneration tool at all. The
failure prints the exact figure to type and stops; typing it by hand is what walks a
person past the note above the entry, where the reason it holds that number is written
down. A `--update` flag would be the one thing capable of erasing those reasons, so it
does not exist rather than existing with a comment-detecting exception.

**The debt can be an ABSENCE, which is what makes it heal by itself.**
`uplink-shape-debt.mjs` counts committed docs assets with no recorded shape, per
Uplink. An asset without one is a picture that `docs --check` is structurally
unable to compare against the code that draws it, so the number is "how many of
this Uplink's pictures nobody can ask a question about". It is not a list of
known-bad files needing a cleanup campaign: the record is written by the ordinary
`gonogo-uplink docs` run, so every legitimate regeneration pays the debt down as a
side effect and nobody has to schedule anything. Seeded at 160 across eleven
Uplinks, and a new Uplink or a new asset is held to zero.

That framing was chosen over the obvious alternative, a list of assets known to be
stale. A staleness list would have needed someone to work through it, and its
entries would have gone out of date the moment anything was re-rendered.

### 3. Snapshot baselines

A committed artefact representing the current state: a serialised description of a
data contract, a rendered image of every component, a generated file. The gate
regenerates and diffs.

These catch changes nobody described in words. A field quietly changing type. A
component whose layout shifted because a shared token moved.

**The trap is regeneration.** A baseline you can refresh with one command, that people
refresh reflexively when it goes red, is not a gate: it is a formality. Ours are
awkward on purpose: image baselines must be regenerated on the same operating system
CI uses, because text rendering differs between platforms and a locally-generated set
would be wrong in a way that looks right.

### 4. Two-sided sync checks

Where the same fact is written in two places: a schema declared in one language and
consumed in another: the gate asserts the two sets are _equal_, and reports both
directions separately: things declared but unknown, and things known but no longer
declared.

The second direction is the one people forget, and it is the one that catches
deletions and renames.

### 5. Design-system ratchets (the most legible example)

If you want one worked example to copy, use this one. Everybody understands the rule
(_no raw hex colours in components, no magic numbers where a design token exists_),
and it is the category where a codebase silently rots fastest, because every single
violation looks harmless at the call site.

We run it as **one gate per token family**, not one "no magic numbers" test:

| Family      | What it owns               | The remedy the failure prints                                   |
| ----------- | -------------------------- | --------------------------------------------------------------- |
| colour      | hex literals               | use a palette token                                             |
| spacing     | `padding`, `margin`, `gap` | `--space-*` rung (`hair/2/4/6/8/10/12/16/24`; 8 is the default) |
| radius      | corner radii               | a `--radius-*` rung                                             |
| font-size   | type scale                 | `--font-size-2xs/xs/sm/base/lg`                                 |
| line-height | leading                    | `--line-height-flush/tight/body/prose`                          |
| z-index     | stacking                   | a named layer                                                   |
| motion      | transitions, animations    | a duration/easing token                                         |

Splitting by family matters more than it looks. A single "magic number" gate produces
one number that means nothing, and one remedy string that cannot be specific. Per
family, the failure message can _teach the ladder_: the person who trips it learns
the scale exists and which rung to use, in the error text, mid-task.

Three things this category taught us that generalise:

**Name tokens by role, not by value.** Our leading tokens are `flush / tight / body /
prose`, not `lh-1 / lh-12 / lh-14 / lh-15`. If the token is named after its number,
swapping the literal for the token achieves nothing: the call site still encodes the
value, and changing the scale later still means editing every call site. A token named
by role is a _decision_ recorded once; a token named by value is a constant with extra
steps.

**Exempt the file, not the directory.** Our very first version excluded the whole
theme package, on the reasonable-sounding grounds that it is where the values live.
The result was that one file inside it carried raw pixel values for spacing and radii
long after the migration was declared complete, because nothing was looking. The
exclusion is now exactly one file: the ladder definitions themselves, where "flagging
them would be flagging the answer as the offence", and the rest of the package is
scanned like anywhere else.

**An exception must argue that the value is not a design decision.** Not "this one is
fine": an actual argument. Two of ours, verbatim in spirit:

> _The clip-rect visually-hidden recipe, whose whole point is to occupy no layout. Its
> 1px box and -1px margin are a matched pair that cancel out: the box exists so screen
> readers still reach the text, and the negative margin removes the pixel it would
> otherwise take. Neither number is a spacing decision, and putting either on the
> ladder would change the box to a size the recipe does not work at._

> _Geometry locked to a third-party grid library's resize handles, not to our ladders:
> the two -10px margins are exactly half the 20px handle they centre. Tokenising
> either would make our scale responsible for someone else's hit area._

Both say the same thing in different words: **this number is not ours to decide**.
That is the only category of exception worth granting, and writing the reason out
forces the distinction. Two companion tests keep it honest: one fails if any
exception lacks a substantive reason, and one fails if an exception names a path that
no longer exists, so the list cannot decay into archaeology nobody dares delete.

### 6. Vocabulary and shape gates

The narrowest kind: a specific spelling, a specific structure. One name for a concept
rather than three. A particular kind of value never hand-formatted. A control never
built from a raw element when a shared one exists.

Individually these look like pedantry. Collectively they are what stops a codebase
accumulating four different words for one thing, which is the state in which nobody
can search for anything.

### 7. Self-verification (the gate that checks itself)

**The most important category, and the least obvious.**

Every scanning gate has a companion test asserting the scan actually found something.
Ours are literally named `actually scanned the tree` and `actually scanned the plugin
clients`.

The reason: a scanner whose pattern is subtly wrong: a path that moved, a regular
expression that stopped matching, a search that only looks at files already tracked by
version control: finds zero violations and passes. It reports the same green as a
clean codebase. Silence is indistinguishable from success.

The stronger version, which the highest-stakes gates use: **plant a deliberate
violation, confirm the gate fails, then remove it.** One of ours fails with the
message `BLIND: the planted violation was not seen`, which is exactly the right thing
for a gate to say about itself.

If you adopt one idea from this document, adopt this one. It costs a few lines and it
is the difference between a gate and a decoration.

**And know which way a silent gate is pointing.** A plant that does not fire is
either a broken instrument or a null change, and those want opposite responses.
Validating the asset-freshness check produced two plants in a row that stayed
green, both correctly: reverting `Row`/`Inline` to before the badge-wrap fix
changed nothing, because the fix is gated on a `wrap` prop defaulting to false and
emits byte-identical CSS otherwise, and the only real DOM change in that commit
was to a component no Uplink renders. Read as "the gate is blind" both would have
prompted a fix to a gate that was working. Establish that the plant is a real
change to something the run actually contains, before concluding anything about
the instrument.

---

## Implementation notes that saved us

**Fail with the offender named.** `3 new violations` is a puzzle. `path/to/file.ts:149
line-height: 1.4: use --line-height-body` is a fix. The failure message is the entire
user interface of a ratchet, and it is read by someone who is mid-task and did not
expect it.

**Say what to do next, including the escape hatch.** Every gate here prints how to
regenerate, how to add a justified exception, and where the reasoning lives, naming
the file to edit and the exact figure to type. A gate with no legitimate escape hatch
gets disabled the first time it is wrong. The consequence for a reader is that the
failure text is the primary source: the triage table under "Start here if one just
failed" is keyed on it for that reason, and where the two disagree the message wins,
because it was generated from the code and this page was not.

**Require a reason for every exception, and test that the reasons are real.** One of
ours has a companion check that every entry has a substantive justification, and
another that fails if an entry names a path that no longer exists, so the list cannot
quietly become archaeology.

**Beware the search key.** Two of our gates were blind for a while. One searched only
files already tracked in version control, so brand-new files: precisely the ones most
likely to be wrong: were invisible. Another matched names by prefix when the thing it
was hunting was named after its mechanism rather than its subject, so it matched
nothing and reported clean. The lesson generalises: **enumerate from the concept down
to the code, never from a naming convention outward.**

**Empty is a destination, not a failure.** Two of our debt lists are now empty. They
stayed in place, still running, still failing on the first new violation. The list
being empty is the goal state, not a reason to delete the gate.

---

## Prompts you can give an agent

These are written to be pasted more or less as-is. Each assumes you are pointing an
agent at a real codebase.

### Establish a new shrink-only ratchet

> There is a rule we want to enforce: **\<state the rule in one sentence\>**. The
> codebase currently breaks it in an unknown number of places, and I do not want to
> fix them all before the rule starts protecting new code.
>
> Build a shrink-only ratchet:
>
> 1. Write a scanner that finds every current violation and prints each with its file
>    and line.
> 2. Put the list of known violations in its own data module with no test logic in it,
>    so a shrink check can load it at an arbitrary git revision cheaply.
> 3. Fail the build on any violation not in that list, naming the file and line and
>    saying how to fix it.
> 4. Add a second check that diffs the list against the same file on the base branch
>    and fails if it has grown. Entries may only be removed.
> 5. **Add a self-check asserting the scan actually found something**, so that a broken
>    pattern or a moved path cannot report clean. Then plant a deliberate violation,
>    confirm the gate fails, and remove it. Tell me what you saw when it failed.
>
> Seed the list with reality rather than an aspiration, and report how many entries it
> starts with.

### Turn a countable problem into a ceiling

> We have a recurring problem that is countable rather than nameable:
> **\<describe it\>**. Build a per-file numeric ratchet.
>
> Requirements, each of which we learned by getting it wrong:
>
> - counts are **per file**, never one project-wide total, so that one file's fix
>   cannot pay for another file's regression
> - decide **ceiling or equality by measuring**: run the count twice on an unchanged
>   tree. If it moves, the entry is a ceiling (more fails, fewer is reported and passes),
>   because a gate that fails on a downward move will go red on an untouched branch. If
>   it does not move, make it an equality: the slack under a ceiling is standing
>   permission for that many new violations, and the over arm cannot see them arrive
> - print the machine load or whatever else makes the count vary, beside the count
> - an entry carrying an explanatory comment must never be lowered automatically by the
>   regeneration tool, because a human chose that number for a reason
> - if there is a regeneration tool, make it **refuse an unscoped rewrite**. Rewriting
>   every entry from one measurement writes that run's number for files the commit never
>   touched. Fixing four files should move four numbers
>
> First, **prove the measurement instrument can see the problem at all**: check
> whether the obvious command actually surfaces it, and tell me if it does not. Then
> plant a violation and confirm the gate fails.

### Lock down a design system

> Our components are full of raw hex colours and magic numbers where design tokens
> exist. I want the leak stopped now and the existing ones paid down over time.
>
> Build a per-family ratchet: colour, spacing, radius, font-size, line-height,
> z-index, motion: rather than one "no magic numbers" test. Each family gets its own
> baseline count and, importantly, **its own remedy string naming the actual ladder**,
> so the failure message teaches someone the scale exists and which rung to use.
>
> Rules:
>
> - **Exempt files, never directories.** A directory exclusion hides everything added
>   inside it later, including the things most likely to be wrong.
> - **Every exception carries an argument that the value is not a design decision**, 
>   locked to a third-party widget's geometry, a matched pair in a known CSS recipe,
>   the ladder definitions themselves. "This one is fine" is not a reason. Add a
>   companion test that fails if any exception lacks a substantive reason, and another
>   that fails if an exception names a path that no longer exists.
> - **Add a self-check that the scan actually found files**, then plant a violation,
>   confirm it fails, and remove it.
>
> Before you start, tell me whether our tokens are named by **role** or by **value**.
> If they are named after their numbers, say so: tokenising against a value-named
> scale records nothing, and we should fix the naming first.
>
> Report the starting count per family, and give me the triage command for paying them
> down.

### Audit an existing gate for blindness

> Here is a gate that currently passes: **\<path\>**. I do not trust that its passing
> means anything. Determine whether it can actually see the failure it claims to check.
>
> Specifically:
>
> - plant a real violation of the rule it enforces and confirm it fails. If it does
>   not, that is the finding
> - check the search key: does the scan cover new and untracked files, generated code,
>   every relevant directory? Would a moved path silently empty its input?
> - check whether the thing it hunts is named after its subject or its mechanism. A
>   name-prefix search misses anything named the other way
> - if it consults a cache, an incremental build, or a shell pipeline, verify a failure
>   propagates rather than being swallowed by an exit code from a wrapper
>
> Report what it can and cannot see. Do not fix it yet.

### Retrofit self-verification across the board

> Every scanning gate in this repository should have a companion test asserting the
> scan actually found something, so that a broken pattern cannot report clean.
>
> Find every gate that scans the tree, and for each: add a self-check that fails if the
> scan's input set is empty or implausibly small. For the highest-stakes ones, add a
> planted-violation check that fails with an explicit BLIND message if the planted
> violation is not seen.
>
> Report which gates were already blind. That list is the point of the exercise.

---

## The one-line version

A ratchet is not primarily about the rule it enforces. It is about making a category
of mistake _visible_, permanently, in a way that cannot quietly stop working, which
means the gate has to be able to fail, and you have to have watched it do so.
