# Rendering your Uplink, and generating its page

Your Uplink's README should show what it adds. Writing that page by hand means
maintaining a list of your own widgets, their data, their extension points and a
folder of screenshots, and every one of those goes stale quietly.

So gonogo ships the renderer and the page as one tool, `gonogo-uplink`. You write
fixtures and one declared `description`; everything else is read off your
registrations.

```
pnpm exec gonogo-uplink render          # every fixture, to ./renders/
pnpm exec gonogo-uplink render --scene flight-plan-healthy
pnpm exec gonogo-uplink docs            # README.md + gonogo-uplink.json + assets
pnpm exec gonogo-uplink docs --check    # CI gate: fail when the page is stale
```

Run it from your client package directory. No `package.json` script is required;
add an alias if you want one.

## What you need installed

The tool ships in `@ksp-gonogo/ui-kit`, which you already depend on. Three
optional peers:

```jsonc
"devDependencies": {
  "playwright": "^1.60.0",              // the browser the render happens in
  "esbuild": "^0.28.0",                 // bundles the generated browser entry
  "@fontsource/jetbrains-mono": "^5.2.8" // the app's own monospace face
}
```

The font is optional and the tool tells you which mode it is in on every run
(`font: locked` or `font: fallback`). Without it your renders use whatever
monospace font the machine has, which is fine for a docs screenshot and not
comparable between machines.

## Fixtures

A fixture is a JSON file under `src/<Anything>/__fixtures__/`. Found by walking,
so there is no registry file to keep up to date.

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
responsive shapes every widget is rendered at (`mobile-9x8`, `portrait-5x18`,
`landscape-18x5`). A fixture may narrow that set and cannot add to it. An augment
or contribution has no `defaultSize` to derive one from, so it takes
`_scene.size: { "w": 13, "h": 12 }` and defaults to that.

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
with a respectable bounding box: what the reader gets is "V…". Both fail here.

Checked at every mode the scene renders, because the narrow shapes are where a
neighbour wraps. When a widget legitimately drops a label at one size, narrow the
scene with `_scene.modes`. Any readable instance passes, so a label that appears
more than once (a "Funds" row in each of three sections) is fine.

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

## When a review render looks cropped and the widget is fine

A review render (`render-widget`, and anything with `fullContent`) grows the tile
until nothing is clipped, so you see the whole widget rather than the top of it.
The growth is a MEASUREMENT, and the thing worth knowing is that it measures a
specific list of nodes:

```js
const nodes = [
  el,                                              // #root
  el.firstElementChild,                            // the Panel container
  ...document.querySelectorAll("[data-scroll-area-inner]"),
  ...document.querySelectorAll("[data-panel-body]"),
];
```

It grows `#root` by the largest `scrollHeight - clientHeight` across those, to a
fixpoint. **A scroller that is not on that list is invisible to it**, because a
scroller clips its own overflow and every ancestor above it then reports no
overflow at all. The tile does not grow, and the widget reads as cropped in the
render while being perfectly correct in the app.

That is not hypothetical. `[data-panel-body]`, Panel's own scroller and the one
every widget uses that does not nest a `ScrollArea`, was missing from the list
until 2026-08-30. It surfaced during the `Panel sections` conversion, and the way
it surfaced is the part to remember: converting a widget to `sections` often
removes a nested `ScrollArea`, which moved that widget from the measured path to
the unmeasured one. So the harness got quietly less trustworthy the more of that
work got done, and every affected widget looked like it had just grown a fresh
layout bug in the commit that converted it.

**So if a render looks cropped:** check whether the content sits in a scroller the
list does not name before you go looking for a layout bug. Adding a new kind of
scroller to the widget set means adding it here too; nothing fails if you forget,
which is exactly why it is written down.

Only the review path is affected. The visual gate and the overlap gate both run
with `fullContent` off and take the fixed tile deliberately, so no baseline and no
overlap finding can move with this list.

## The page

`gonogo-uplink docs` writes three things at your package root:

- `README.md`, generated
- `gonogo-uplink.json`, the manifest the app's loader reads before it will import
  your bundle
- `docs/assets/*.png` and `*.gif`

You write ONE FIELD, and it is not a file: `description` on
`defineUplinkClient`, one or two sentences saying what the Uplink does. The tool
refuses to write a page without one.

```ts
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

### `gonogo-uplink.json`

**`docs` and `bundle` write the same file.** They used to write two different
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
halves of your Uplink (`creating-an-uplink.md`, "Distribution"). An Uplink
without one carries empty strings rather than an invented author.

`integrity` is the sha256 of the file you distribute, so pass `--bundle <path>`
when you generate for a release; without it the field is empty and the app will
quarantine your Uplink with an integrity mismatch, and the run warns you.

The one field nothing can derive is `minAppVersion`, which is a claim about the
APP rather than about your code. Declare it as `"minAppVersion": "1.4.0"` in your
`uplink.json`, or in your `package.json` when you have no `uplink.json`:

```jsonc
"gonogo": { "minAppVersion": "1.4.0" }
```

`uplink.json` wins when both declare it.

Your `defineUplinkClient({ version })` must equal your `package.json` version. The
tool refuses to write a manifest where they disagree, because the app compares
what it reads in the manifest against what your loaded bundle declares.

### Gating it: two halves, and only one needs a browser

Keeping the page current is two different questions, and it is worth knowing
which is which because they cost very different amounts.

**Does the page's text still match the registrations?** That is a registry read, and
your test suite has already loaded your client with a host installed. So it runs
as a test, with no browser:

```ts
// client/src/uplink-page.test.ts
import { expectUplinkPageCurrent } from "@ksp-gonogo/ui-kit/page-check";
import "./index";  // your client, so its registrations happen

it("the generated page still describes this Uplink", () => {
  expectUplinkPageCurrent();
});
```

Add a widget without regenerating and that fails. It is the same
`readInventory` and the same `buildReadme` the generator uses, not a second
implementation, so it cannot start describing a different Uplink from the one the
pictures are of.

**Are the committed images current?** That one has to render, so it needs
Chromium: `gonogo-uplink docs --check`, wherever your CI has Playwright.

```
pnpm exec gonogo-uplink docs --check
```

Run both if you can. Run the first if you can only run one: it is the half that
catches a widget quietly missing from the page, and a page listing three of your
four widgets reads exactly like an Uplink with three widgets.

Two things neither half compares. **Asset bytes**: rasterisation is per-engine
and per-OS, so a byte comparison would fail on every machine but the one that
generated it, and a gate that cries wolf is a gate someone turns off. Only WHICH
assets exist is checked. **`integrity`**: it is a fact about a release artifact,
absent from a working copy, so the test ignores it outright and `docs` leaves it
empty until you pass `--bundle`.

## Your own browser-side glue

Most Uplinks need none. If yours has a fake only you can write (a fake data
source with a bespoke status surface, a WebRTC session), put it in
`client/gonogo-render.setup.ts` and the generated entry picks it up:

```ts
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
