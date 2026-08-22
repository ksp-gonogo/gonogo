# Rendering your Uplink, and generating its page

Your Uplink's README should show what it adds. Writing that page by hand means
maintaining a list of your own widgets, their data, their extension points and a
folder of screenshots, and every one of those goes stale quietly.

So gonogo ships the renderer and the page as one tool, `gonogo-uplink`. You write
fixtures and one prose file; everything else is read off your registrations.

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

## The page

`gonogo-uplink docs` writes three things at your package root:

- `README.md`, generated
- `gonogo-uplink.json`, the manifest the app's loader reads before it will import
  your bundle
- `docs/assets/*.png` and `*.gif`

You write ONE file, `uplink.md`. A lede saying what the Uplink is for and which
mod it integrates, install notes, and optional `## widget:<id>` /
`## augment:<id>` / `## contribution:<id>` sections adding prose to one
registration. Nothing in it should repeat a derived fact, and two guards make that
structural: a section naming an id you did not register fails the build, and a
registered widget with no fixture fails the build, because a page that quietly
lists three of your four widgets reads exactly like an Uplink with three widgets.

Per-widget descriptions do NOT go in `uplink.md`. `ComponentDefinition.description`
is required, so every widget already has one place for its one line, and a second
place is how two of them start disagreeing.

### `gonogo-uplink.json`

Almost every field is derived. `id`, `version`, `apiVersion`, `uiKitVersion`,
`contractMajor` and `contractMinor` come from the bundle the tool just loaded, so
they describe the code they were read out of. `description` is your lede's first
paragraph. `integrity` is the sha256 of the file you distribute, so pass
`--bundle <path>` when you generate for a release; without it the field is empty
and the app will quarantine your Uplink with an integrity mismatch, and the run
warns you.

The one field nothing can derive is `minAppVersion`, which is a claim about the
APP rather than about your code. Declare it in your `package.json`:

```jsonc
"gonogo": { "minAppVersion": "1.4.0" }
```

Your `defineUplinkClient({ version })` must equal your `package.json` version. The
tool refuses to write a manifest where they disagree, because the app compares
what it reads in the manifest against what your loaded bundle declares.

### `--check`

Put `gonogo-uplink docs --check` in CI. It regenerates into a temporary directory
and fails on any difference in `README.md`, in `gonogo-uplink.json`, or in WHICH
assets exist. That makes the page a build artifact under a gate rather than a
document under a convention, which is the only version of this that survives a
busy week.

It compares asset NAMES and not their bytes. Rasterisation is per-engine and
per-OS, so byte-comparing a PNG would fail on every machine but the one that
generated it, and a gate that cries wolf is a gate someone turns off.

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

## What it cannot show you

An augment renders inside a STAND-IN panel, not inside its real host widget. Host
widgets ship with the app and an Uplink may not import them, so the section's own
layout is faithful and how it sits under the host's own rows is not shown. Every
image on the page says which of those it is, and so does the render's own title
bar: you should never have to guess whether you are looking at the real host.

An augment that draws in its host's coordinate space (a map projection, an SVG
transform) has nothing to draw against in a stand-in and cannot be honestly
previewed at all. Those are listed on the page without a picture, with the reason,
rather than shown as a blank frame.
