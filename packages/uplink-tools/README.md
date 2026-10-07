# @ksp-gonogo/uplink-tools

The Uplink author's toolchain: it scaffolds an Uplink, bundles its client,
renders its scenes in a real browser, generates its page, and supplies the app's
own widgets as the host widgets an augment is drawn inside.

It is a **devDependency**. Nothing here ships in an Uplink's bundle.

## The command line

One command, `uplink-tools`, and nothing to install before the first run:

```sh
npx @ksp-gonogo/uplink-tools new myuplink --repo you/myuplink   # in an empty directory
npx @ksp-gonogo/uplink-tools --help
```

`new` asks what it was not told: the id, a display name, the author, the
repository it will be published from, whether it has Topics of its own, whether
to write a CI workflow, and where KSP is. Every question is also a flag
(`uplink-tools new --help` lists them), and `--yes` takes the default for the
rest. With no terminal it never asks: it stops, writes nothing and names each
missing flag, so a script or an agent can fix its call in one go.

`new` writes the Uplink and then runs its generators, so the directory it leaves
builds and tests: `npm test` in `client/`, and `dotnet test mod-tests`. It needs
Node and the .NET SDK, and no clone of anything. The C# half reaches Gonogo
through one NuGet package, `KspGonogo.Sitrep.Contract`, at the same version as
this package.

Once it is in an Uplink's devDependencies the same commands answer to
`uplink-tools` in a `package.json` script, which is what a workflow calls:

| command | what it does |
|---|---|
| `new <id>` | scaffold an Uplink: contract slice, plugin, tests, one widget and its fixture, then generate its client types, install the client and write its page. In a repo with an `uplinks/` folder it goes to `uplinks/<id>/`; anywhere else the current directory becomes the Uplink |
| `codegen` | generate `client/src/__generated__/` from the C# contract slice; `codegen --check` fails on drift |
| `bundle` | build the client bundle the app loads, and the `gonogo-uplink.json` beside it; `--watch` rebuilds on every change and `--serve <port>` also serves it from this computer |
| `bake` | write what the plugin tells the app about its client into C#: where the bundle lives, who wrote it, and the hash the mod vouches for |
| `package` | lay the built plugin out as `GameData/<name>/` and zip it with that as the zip's one root, which is what a hand install and CKAN both expect; it refuses a netkan whose install stanza names a path the zip does not hold |
| `release` | `bundle`, `bake`, compile the plugin, check the DLL carries what was baked, and `package`, in that order. It refuses when the Uplink's version is not the same in `client/package.json`, in `defineUplinkClient` and in the version folder of `client.url` |
| `page` | write `README.md`, `gonogo-uplink.json` and `docs/widgets.json` from what the client registers, with no browser |
| `render` | render every scene to `renders/` |
| `docs` | write `README.md`, `gonogo-uplink.json`, `docs/widgets.json` and `docs/assets/`; `docs --check` fails on drift |

The order inside `release` is the point of it. The app loads an installed
Uplink's client only when the plugin says where the bundle lives and vouches for
its hash, so the bundle has to be built and hashed before the plugin is
compiled. A plugin baked without its bundle builds, tests green, and shows no
widget.

### Working on the client without rebuilding the plugin

A hash goes stale the moment the client changes, so a development loop uses a
plugin that vouches for none. The app loads its client anyway on two conditions,
both required: the plugin declares a dev path, and that path is on the computer
the app is open on (`localhost`, `127.0.0.1` or `[::1]`). It says in words, on
the Uplink's status page and on every widget the Uplink draws, that an unvouched
development client is running.

```sh
cd client
npx uplink-tools bundle --serve 5173        # leave running: rebuilds and serves on every change
npx uplink-tools bake --dev-path http://localhost:5173/<id>.client.js
dotnet build ../mod -c Release              # once, then copy the DLLs into GameData/<name>/Plugins
```

Reload the app after a change to the client. The plugin is compiled again only
when the C# changes. A dev path anywhere else is refused with the reason, and so
is a station, which takes its bundles from the main screen. `release` does not
zip a plugin baked with a dev path unless it is told `--allow-dev-package`.

Every command takes `--help`, and refuses a flag it does not read.

## What is in it

| entry | what it is |
|---|---|
| `@ksp-gonogo/uplink-tools` | the harness API and the `uplink-tools` command's `run`. Node: esbuild, Playwright, the filesystem |
| `@ksp-gonogo/uplink-tools/render-probe` | the browser half, which mounts a widget in the page the harness builds |
| `@ksp-gonogo/uplink-tools/page-check` | the assertion an Uplink's own suite runs to keep its committed page honest. Deliberately free of Playwright, so an author with no browser can still run it |
| `@ksp-gonogo/uplink-tools/widgets` | the app's own widgets, registered, so a scene can name one as its `_scene.hostWidget` |

You will not usually import the first of these: the command line runs it.

`uplink-tools docs` writes `README.md`, `gonogo-uplink.json` and
`docs/widgets.json`, the record of each widget you register. The README's widget
sections are rendered from those records, and `docs --check` and
`expectUplinkPageCurrent` fail when any of the three no longer matches your
registrations. Commit all three.

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
the newest `validAt` delivered (an emit naming none counts as `pinnedUt`), and
the craft's present runs one light time ahead of it.
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
    "@ksp-gonogo/uplink-tools": "<the same version as your sitrep-sdk and ui-kit>"
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

**`/widgets` is for the docs page only.** Name it in `devDependencies` and in
`gonogo.renderWith`, and nowhere else: never put `@ksp-gonogo/uplink-tools` in
`dependencies`, and never import `/widgets` from your client. If you want one
of its components for real use, ask for that component in `@ksp-gonogo/ui-kit`.

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

## Its relation to `@ksp-gonogo/ui-kit`

`@ksp-gonogo/ui-kit` is a peer dependency: install the two at matching
versions. The harness draws with the kit and its `/grid` and `/testing`
entries, and the app widgets behind `/widgets` are built on it.
