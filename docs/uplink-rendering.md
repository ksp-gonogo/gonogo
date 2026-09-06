# Rendering your Uplink, and generating its page

Your Uplink's README should show what it adds. Writing that page by hand means
maintaining a list of your own widgets, their data, their extension points and a
folder of screenshots, and every one of those goes stale quietly.

So gonogo ships the renderer and the page as one tool, `gonogo-uplink`. You write
fixtures and one declared `description`; everything else is read off your
registrations.

```
pnpm exec gonogo-uplink bundle          # the file you distribute + its manifest
pnpm exec gonogo-uplink render          # every fixture, to ./renders/
pnpm exec gonogo-uplink render --scene flight-plan-healthy
pnpm exec gonogo-uplink docs            # README.md + gonogo-uplink.json + assets
pnpm exec gonogo-uplink docs --check    # CI gate: fail when the page is stale
```

Run it from your client package directory. No `package.json` script is required;
add an alias if you want one. `gonogo-uplink --help` lists every command, and
each command takes `--help` of its own.

**What it loads to find your registrations** is `src/index.ts`, or `src/index.tsx`,
or your `package.json`'s `main` if neither exists, in that order. Source before a
build output on purpose: a render of `dist/` is a screenshot of whatever the last
build contained, with nothing to say it is stale. `--entry <file>` names a
different one. That module has to reach every registration, which it does the way
the app does, by bare-importing them for their side effects:

```ts
// client/src/index.ts
import "./uplink";   // defineUplinkClient(...) runs first
import "./Reactor";  // registerComponent(...)
```

If the entry misses a module, that Uplink is missing a widget everywhere at once:
in the render, in the page and in the app. Nothing is silently smaller, though:
a bundle that declares no client at all fails naming the cause, and a registered
widget with no fixture fails naming the widget.

## What you need installed

The `gonogo-uplink` command itself is `@ksp-gonogo/sitrep-sdk`'s, which every
Uplink already depends on, and `bundle` and `bake-hash` need nothing else.
`render` and `docs` drive a real browser, and that half lives in
`@ksp-gonogo/ui-kit`: the sdk resolves it from YOUR package when one of those two
verbs is used, so it is never loaded by a CI job that only bundles.

```jsonc
"devDependencies": {
  "@ksp-gonogo/ui-kit": "^0.2.0",        // the browser half of render / docs
  "playwright": "^1.60.0",               // the browser the render happens in
  "esbuild": "^0.28.0",                  // bundles the generated browser entry
  "@fontsource/jetbrains-mono": "^5.2.8" // the app's own monospace face
}
```

**The playwright package is not a browser.** Installing it gets you the driver
and no executable to drive, and the first `render` then dies on a missing one. So
both halves, locally and in CI:

```
npm i -D playwright && npx playwright install chromium
```

`--engine firefox` and `--engine webkit` work the same way and want the matching
`npx playwright install`.

The font is optional and the tool tells you which mode it is in on every run
(`font: locked` or `font: fallback`). Without it your renders use whatever
monospace font the machine has, which is fine for a docs screenshot and not
comparable between machines.

## Fixtures

A fixture is a JSON file under `src/<Anything>/__fixtures__/`. Found by walking,
so there is no registry file to keep up to date. **Its filename, minus `.json`,
is the scene's name**: that is what `--scene` matches and what the rendered
`<scene>--<mode>.png` is called, so `src/Reactor/__fixtures__/flight-plan-healthy.json`
is `--scene flight-plan-healthy`. A name that matches nothing fails listing every
scene it knows.

```jsonc
{
  "_scene": {
    "widget": "reactor-status",   // xor "augment" / "contribution", by registered id
    "caption": "A reactor at 80% output with one coolant loop offline",
    "config": { "compact": true },      // per-instance config overlay
    "modes": ["default", "min"],        // optional; narrows the derived set
    "paints": ["REACTOR", "80%"],       // text that must be readable; see below
    "expectsEmpty": "why this scene has nothing to draw"  // see below
  },
  "_stream": {
    "pinnedUt": 1000000,
    "emits": [
      { "topic": "mymod.reactor", "payload": { "output": 0.8 } }
    ]
  }
}
```

Two things a fixture deliberately does NOT carry.

**The carried-channel allowlist**, because your registration already declares it:
the tool derives it from `channels`, `optionalChannels` and `dataRequirements`,
and folds in the dynamic whole-topic prefixes the app folds in. If a topic your
fixture emits is not reachable that way, the run tells you and names it.

**The pixel size.** Modes come from `defaultSize` and `minSize`, plus the three
responsive shapes every widget is rendered at. So a widget's mode names are drawn
from exactly five, in one namespace, and `_scene.modes` may name any mix of them:

| mode | where it comes from |
| --- | --- |
| `default` | the registration's `defaultSize` |
| `min` | the registration's `minSize`, and only when it differs from `defaultSize` |
| `mobile-9x8` | fixed, 9 × 8 grid units |
| `portrait-5x18` | fixed, 5 × 18 |
| `landscape-18x5` | fixed, 18 × 5 |

A fixture may narrow that set and cannot add to it; naming one the target does not
have fails listing the ones it does. An augment or contribution has no
`defaultSize` to derive one from, so it takes `_scene.size: { "w": 13, "h": 12 }`
and defaults to that.

### Using the widget before the shot

Some surfaces have nothing to show until they are used: a plan composer with no
plan in it is a button, and a video feed's controls are hover-gated and invisible
at rest. `_scene.before` is an ordered list of things done to the mounted widget,
through real input events, before it is photographed.

```jsonc
"_scene": {
  "before": [{ "press": "Draft plan" }, { "press": "Add burn" }]
}
```

`press` takes an accessible NAME, because that is the handle an operator has;
`hover` takes a CSS selector; `rest` moves the pointer off everything, for the
resting half of a hover pair. Feeding the same state in through the fixture would
render a composer that had never composed anything, and the difference between
those two is most of what a render of a composer is for.

### Motion

A still already answers "what does this look like". Motion earns its place only
where the thing the widget exists to show IS a change: a badge escalating, a plan
failing to integrate, an arm-then-confirm, a needle sweeping.

```jsonc
"_scene": {
  "steps": [
    { "emit": { "topic": "mymod.reactor", "payload": {} } },
    { "advanceUt": 60, "frames": 24 },
    { "click": "[data-arm]" }
  ],
  "motion": { "fps": 12, "pingPong": true }
}
```

`advanceUt` steps the PINNED clock, frame by frame. That is the difference between
this and a screen recording: the clock is an input, so the same fixture produces
the same frames on any machine. The output is a GIF, because that is what embeds
in a README on GitHub; `--frames` also keeps the numbered PNGs.

A control whose behaviour is a HELD pointer needs two more steps. `hold` presses
on a named control and drags it without letting go, `release` lets go, and
`waitMs` lets real milliseconds pass, spread over the step's frames:

```jsonc
"steps": [
  { "hold": { "name": "Ignition rate", "dx": 30 }, "waitMs": 1200, "frames": 10 },
  { "release": true, "waitMs": 400, "frames": 4 }
]
```

`waitMs` is not a substitute for `advanceUt`: that one steps the pinned clock,
which is what keeps a countdown reproducible, and this one waits, which is the
only thing a control ticking on its own `setInterval` responds to. Reach for it
only when the control genuinely runs on elapsed time.

## Naming text that has to be readable

`_scene.paints` is a list of strings the render must actually show, each in a box
bigger than nothing and not clipped by its own overflow.

```jsonc
"_scene": { "widget": "reactor-status", "paints": ["Coolant loop B", "OFFLINE"] }
```

It is not a duplicate of your test suite's assertions, and it is worth having
because of what those cannot see. jsdom computes no layout, so a label squeezed
to zero width by a neighbour that wrapped is present in the DOM, findable by role
and name, and invisible on screen. `text-overflow: ellipsis` is the same failure
with a respectable bounding box: what the reader gets is "V...". Both fail here.

Checked at every mode the scene renders, because the narrow shapes are where a
neighbour wraps. When a widget legitimately drops a label at one size, narrow the
scene with `_scene.modes` to the modes where the label is meant to survive. Any
readable instance passes, so a label that appears more than once (a "Funds" row in
each of three sections) is fine.

Not available on a motion scene: what one exists to show is text arriving and
leaving, so there is no single moment the assertion could be about.

## The two things a run refuses to do

**It will not hand you a picture of nothing.** Every scene is rendered twice, once
fed and once with every emission suppressed, and the run fails when the two renders
match. An empty widget looks the same whether it works or not, so a scenario named
after a state it does not actually show is invisible to a reviewer and to you. When
a scene's subject genuinely IS an empty state, say so:

```jsonc
"_scene": { "expectsEmpty": "no contracts have been offered yet, which is the state" }
```

It takes prose rather than `true` deliberately. "This widget has nothing to draw
here" is a claim someone can check in a year, and a boolean is not.

**It will not let an emission vanish.** The stream fixture is subscription-gated
exactly as production is, so a payload nothing subscribed to is dropped in
silence. The run reports every such topic by name, with the derived allowlist
beside it, so a fixture feeding a topic your widget does not read is an error
rather than a blank panel.

## Nothing in a render is cropped, so a clipped label is a finding

Before every shot the harness grows `#root` until nothing is clipped, so you get
the whole widget rather than the top of it. It finds the clipping boxes rather
than working from a list: every element under the root is measured, and any that
is not `overflow-y: visible` and whose content is taller than its box contributes
to the growth, iterating to a fixpoint because growing the box can reveal a little
more. **There is nothing to keep up to date here.** A widget that grows a new kind
of scroller is measured the day it does.

That was worth building the awkward way round. The obvious implementation is a
list of the selectors content hides behind, and a list is invisible to exactly the
case it is for: a scroller that is not named clips its own overflow, every
ancestor above it then reports no overflow at all, the tile does not grow, and the
widget reads as cropped in the render while being perfectly correct in the app. A
list has to be edited by whoever adds the scroller, and nothing fails when they
do not.

Only the VERTICAL crop is lifted. The mount still lays out at the real tile
WIDTH, so responsive breakpoints engage exactly as they do in the dashboard, and
that is deliberate: a label ellipsised or squeezed to nothing by its neighbours
is a real layout finding at that width, not an artifact of the harness. It is
what `_scene.paints` is for.

## The page

`gonogo-uplink docs` writes three things at your package root:

- `README.md`, generated
- `gonogo-uplink.json`, the manifest the app's loader reads before it will import
  your bundle
- `docs/assets/*.png` and `*.gif`

**`README.md` is generated in full, so `docs` replaces it whole**, every run. It
will not replace one it did not write: every generated README opens with a
`<!-- Generated by \`gonogo-uplink docs\`. -->` comment, and a `README.md` without
that line stops the command with the file untouched. Move your prose somewhere
the generator does not write and run it again.

You write ONE FIELD, and it is not a file: `description` on
`defineUplinkClient`, one or two sentences saying what the Uplink does. The tool
refuses to write a page without one.

```ts
// client/src/uplink.ts
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

export const MY_UPLINK = defineUplinkClient({
  id: "my-uplink",
  version: "0.0.1",
  name: "My Uplink",
  description: "What it does, in a sentence or two.",
});
```

There was a prose file (`uplink.md`) with a lede, install notes and optional
`## widget:<id>` sections. It is gone, and the reason is what happened to it: a
markdown file beside your client is an invitation to write markdown, and the ten
in the app's own repo grew per-widget rationale on top of the descriptions their
registrations already carried, install notes, and restatements of rules true of
every Uplink. A field has a shape and one job; a file has whatever someone types.

**A generated page contains exactly four things**: your description, each
widget's own registered description, DATA in tables, and the screenshots. If
something you want to say is not one of those, it is documentation about Uplinks
rather than about yours, and it belongs here rather than on your page. The test
to apply: a reader should skim the whole page in under a minute and come away with
what your Uplink does, what its widgets show, and what it puts on the wire.

Per-widget descriptions come from `ComponentDefinition.description`, which is
required, so every widget already has one place for its one line and a second
place is how two of them start disagreeing.

One guard is structural: a registered widget with no fixture is reported, because
a page that quietly lists three of your four widgets reads exactly like an Uplink
with three widgets.

### The bundle, and the two copies of `gonogo-uplink.json`

`gonogo-uplink bundle` builds the file the app loads. It reads your `uplink.json`
for the id (see below), bundles your entry with esbuild, and writes three files:

```
dist/<id>/<id>.client.js         # the bundle you distribute
dist/<id>/<id>.client.js.sha256  # its digest, for a release script
dist/<id>/gonogo-uplink.json     # the manifest that SHIPS, integrity already filled
```

`--client <dir>` (default: the working directory), `--entry <file>` (default:
`src/index.ts`) and `--out <dir>` (default: `<client>/dist`) move those. Each
Uplink gets its own directory because the loader derives the sidecar's URL from
the bundle's own by stripping the last path segment, so two Uplinks published
into one flat directory share one sidecar path and the last one written wins.

So there are two copies of this file and they have different jobs. The one
`bundle` writes beside the bundle is the one the app fetches, and it is stamped.
The one `docs` writes at your package root is the copy that gets COMMITTED, and
`docs --check` and the page test compare against it.

**`docs` and `bundle` write the same shape.** They used to write two different
shapes under one filename with nothing to say which the loader honours; they now
call one writer in the SDK, so running either gives you the same manifest.

Almost every field is derived. `id`, `name`, `version`, `apiVersion`,
`uiKitVersion`, `contractMajor` and `contractMinor` come from the bundle the tool
just loaded, so they describe the code they were read out of. `description` is
the field you declared on `defineUplinkClient`. `bundleUrl` is where your bundle
sits relative to the manifest, which is the only thing either command can
honestly say about it: the loader finds the manifest by stripping the last
segment off the bundle's URL, so the two are always siblings. `sdkVersion` is the
version of the tool that wrote the file.

`author` and `repo` are yours, and they come from the `uplink.json` beside both
halves of your Uplink. It is searched UPWARD from your client package, three
levels, so a flat template (`uplink.json` one level up) and the first-party
monorepo layout (two levels up) are both found. An Uplink without one carries
empty strings rather than an invented author. Its full contents are in
`creating-an-uplink.md`, "Distribution".

`integrity` is the sha256 of the file you distribute. **`bundle` fills it for
free**, because it has just written the bytes; that is the copy the app hashes
and quarantines on, and there is nothing to remember. The committed copy `docs`
writes is a different question: a working copy has no distributed file, so
`docs` leaves the field empty and says so on stderr, and the page test strips the
field before comparing for exactly that reason. `docs --bundle <path>` stamps it
if you want the committed copy stamped too, and a release is the only time that
is worth doing, because `docs --check` compares the manifest byte for byte, so a stamped
committed copy makes every later plain `--check` disagree with itself.

The one field nothing can derive is `minAppVersion`, which is a claim about the
APP rather than about your code. Declare it as `"minAppVersion": "1.4.0"` in your
`uplink.json`, or in your `package.json` when you have no `uplink.json`:

```jsonc
"gonogo": { "minAppVersion": "1.4.0" }
```

`uplink.json` wins when both declare it, and absent means `"0.0.0"`, no floor.

Your `defineUplinkClient({ version })` must equal your `package.json` version. The
tool refuses to write a manifest where they disagree, because the app compares
what it reads in the manifest against what your loaded bundle declares.

### Gating it: two halves, and only one needs a browser

Keeping the page current is two different questions, and it is worth knowing
which is which because they cost very different amounts.

**Does the page's text still match the registrations?** That is a registry read,
which your test suite is already set up for: an Uplink's suite loads its own
client under jsdom against a host installed by `installRealTestHost` (from
`@ksp-gonogo/sitrep-sdk/testing`, in your vitest `setupFiles`. See
`creating-an-uplink.md`, "Testing your Uplink"). So it runs as a test, with no
browser:

```ts
// client/src/uplink-page.test.ts
import { expectUplinkPageCurrent } from "@ksp-gonogo/ui-kit/page-check";
import "./index";  // your client, so its registrations happen

it("the generated page still describes this Uplink", () => {
  expectUplinkPageCurrent();
});
```

There is no vacuous pass hiding in that setup. Without a host installed the
client's own module-load `registerComponent` throws, so the import fails before
the assertion; with a host but nothing imported, the check finds no declared
Uplink client and says so, naming that as the usual cause. The failure you get is
never "everything is fine".

Add a widget without regenerating and that fails too. It is the same
`readInventory` and the same `buildReadme` the generator uses, not a second
implementation, so it cannot start describing a different Uplink from the one the
pictures are of.

**Are the committed images current?** That one has to render, so it needs a
browser: `gonogo-uplink docs --check`, wherever your CI has Playwright and its
chromium.

```
pnpm exec gonogo-uplink docs --check
```

Run both if you can. Run the first if you can only run one: it is the half that
catches a widget quietly missing from the page, and a page listing three of your
four widgets reads exactly like an Uplink with three widgets.

One thing neither half compares is **asset bytes**: rasterisation is per-engine
and per-OS, so a byte comparison would fail on every machine but the one that
generated it, and a gate that cries wolf is a gate someone turns off. Only WHICH
assets exist is checked, plus their recorded shapes.

## Your own browser-side glue

Most Uplinks need none. If yours has a fake only you can write (a fake data
source with a bespoke status surface, a WebRTC session), put it in
`client/gonogo-render.setup.ts` and the generated entry picks it up. Name it
`gonogo-render.setup.tsx` when it contains JSX, as the `wrap` hook below does:
both spellings are looked for, and JSX will not parse in a `.ts` file.

```tsx
// client/gonogo-render.setup.tsx
import { registerDataSource, unregisterDataSource } from "@ksp-gonogo/sitrep-sdk";
import { defineRenderSetup } from "@ksp-gonogo/ui-kit/render-probe";

export default defineRenderSetup({
  beforeScene({ scene, starve }) {
    // `starve` is the fed-versus-starved comparison asking you to feed nothing.
    // A setup that ignores it defeats the one check that catches a picture of
    // no data.
    if (!starve) registerDataSource(myFake);
  },
  afterScene() { unregisterDataSource("mine"); },
  wrap(children) { return <MyProvider>{children}</MyProvider>; },
});
```

## Mounting an augment in its real host

By default an augment renders inside a STAND-IN panel. The section's own layout is
faithful; how it sits under the host's own rows is not shown, and an augment that
draws in its host's coordinate space (a map projection, an SVG transform) has
nothing to draw against at all. Every image on the page says which it is, and so
does the render's own title bar, so you never have to guess.

A scene can name the real host instead:

```jsonc
"_scene": {
  "augment": "rp1-ksc-construction",
  "host": "space-center-status",
  "size": { "w": 12, "h": 14 }
}
```

The host mounts for real, the augment reaches its slot the way it does in the
dashboard, and the scene is sized and fed AS the host, because the host is what is
on screen. `_scene.size` is optional and overrides the host's own tile: a host's
`defaultSize` is chosen for the host alone, and an operator who has added three
sections to it has made it bigger.

**This is an in-repo affordance, not an author surface.** A host widget ships
with the APP, in a package nobody outside this repo can install, so the run has
to be told which module registers it. Declare that once, beside `minAppVersion`:

```jsonc
"gonogo": {
  "renderWith": ["../../../packages/components/src/index.ts"]
}
```

Paths relative to your client package, not module specifiers. `--with <module>`
does the same thing for a single run. Without either, a scene naming a host fails
with the host it could not find and the list of what was in the bundle.

Every augment registered on that slot mounts, not only the one the scene is of,
which is the honest picture and is worth knowing when you read one: a section
below yours in the same slot is really there.
