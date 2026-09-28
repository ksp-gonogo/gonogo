# @ksp-gonogo/uplink-tools

The Uplink docs toolchain: it renders an Uplink's scenes in a real browser,
generates its page, and supplies the app's own widgets as the host widgets an
augment is drawn inside.

It is a **devDependency**. Nothing here ships in an Uplink's bundle.

## What is in it

| entry | what it is |
|---|---|
| `@ksp-gonogo/uplink-tools` | the harness API and the `gonogo-uplink render` / `docs` implementation. Node: esbuild, Playwright, the filesystem |
| `@ksp-gonogo/uplink-tools/render-probe` | the browser half, which mounts a widget in the page the harness builds |
| `@ksp-gonogo/uplink-tools/page-check` | the assertion an Uplink's own suite runs to keep its committed page honest. Deliberately free of Playwright, so an author with no browser can still run it |
| `@ksp-gonogo/uplink-tools/widgets` | the app's own widgets, registered, so a scene can name one as its `_scene.hostWidget` |

You will not usually import the first of these: `gonogo-uplink render` and
`gonogo-uplink docs` forward to it, resolved from your own install.

## What a fixture puts on the stream

A fixture's `_stream` block is the wire its scene is fed from:

```json
{
  "_scene": { "widget": "reactor" },
  "_stream": {
    "pinnedUt": 1000,
    "delaySeconds": 60,
    "emits": [
      { "topic": "example.reactor", "payload": {}, "validAt": 940 },
      { "topic": "example.reactor", "payload": {} }
    ]
  }
}
```

| field | what it does |
|---|---|
| `emits` | replayed once the scene has subscribed, in the order written, or in the order sent under `delaySeconds`. An entry's `validAt` is the instant it was sent; with none it was sent at `pinnedUt` |
| `pinnedUt` | the operator's view time, which the scene is drawn at when it has no `delaySeconds`. Defaults to `1000000` |
| `stopsArriving` | drop the link once every emit has landed, so the picture is of figures that are held |
| `delaySeconds` | a one-way light time between the craft and the screen, in seconds |

**`delaySeconds`** stages what an operator sees across a light time. Each
reading sent at `validAt` is delivered `delaySeconds` later, the view time is
the received edge (the latest `validAt` delivered, where an emit naming none
counts as `pinnedUt`), and the craft's present runs one light time ahead of it.
Every reading is reckoned to that present exactly as it is in the app, so a
scene can show a modelled figure beside the observed one, drawn with the kit's
modelled mark. Without it, or at `0`, the view time and the craft's present are
one instant and nothing is carried across. A reckoner that fits a trend needs
more than one reading, so give those emits a history of `validAt`s. If your
widget reads the light time off `comms.delay`, emit that too: the delay stages
the clock, not the topic.

Under a delay an `advanceUt` step moves the craft's present and leaves the view
time where it is until something newer is delivered, so a negative `advanceUt`
is refused.

## Using the host widgets

An Uplink's docs page shows its widgets, and some of them are an AUGMENT or a
CONTRIBUTION into a widget that ships with the app. To draw one honestly you
need the widget around it:

```json
{
  "devDependencies": {
    "@ksp-gonogo/uplink-tools": "^0.1.0"
  },
  "gonogo": {
    "renderWith": ["@ksp-gonogo/uplink-tools/widgets"]
  }
}
```

A fixture can then name the widget it extends:

```json
{ "_scene": { "hostWidget": "strategies" } }
```

There is nothing to `import` from `/widgets`. It exports no symbols: importing it
runs the app widgets' own registrations, which is all the harness needs to
resolve a scene's `hostWidget`.

**`/widgets` is the one entry with a position rule.** It may appear in
`devDependencies` and in `gonogo.renderWith`, and nowhere else. Putting
`@ksp-gonogo/uplink-tools` in `dependencies`, or importing `/widgets` anywhere in
your client, fails `uplink-isolation.test.ts`. From the ruling that created it:

> "typically pulling the widgets into the UI kit is only for the docs page,
> right? It's not for anything else."

If you want a component from it for real use, that is a request to move that
component into `@ksp-gonogo/ui-kit`.

## Why a stand-in is not enough

The harness already synthesises a stand-in for a scene that names none, and it
covers more than you would expect: an augment mounts in that stand-in's `Panel`,
and `Panel` draws every widget's `<id>.badges` itself, so a badge contribution
lands there exactly as it lands in the real widget.

Every **other** contribution slot is drawn by the host widget's own body, and a
stand-in's body draws nothing. `strategies.screens`,
`space-center-status.facilities` and `astronaut-complex.readouts` are each read
by a `useContributions(...)` inside the widget. Standing in for those produces a
blank frame that reports success. A real widget's own body is the only thing that draws
them.

## Why this is not part of `@ksp-gonogo/ui-kit`

It was, as four subpaths. A design system has no business shipping a
Playwright-driven doc harness, and the widgets could not live there at all: they
need `@ksp-gonogo/components`, which depends on the kit, so carrying them inside
the kit is a build-graph cycle. Outside it, it is an ordinary one-way
dependency.

The kit remains a peer, and `gridUnits` is the single module this package takes
back from it.
