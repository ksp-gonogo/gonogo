# @ksp-gonogo/uplink-tools

The command line and test harness for writing an Uplink, the extension that connects a KSP mod to the Gonogo app. It scaffolds an Uplink, bundles its client, draws its widgets in a real browser, writes its generated page and releases it. It also supplies the app's own widgets, so a widget that extends one can be drawn inside it.

It is a devDependency. Nothing in it ships in an Uplink's bundle.

**The [Uplink developer docs](https://ksp-gonogo.github.io/uplink-dev-docs/) are the guide to using it**, and the [command-line reference](https://ksp-gonogo.github.io/uplink-dev-docs/reference/tools/command-line) lists every command and flag. This page holds what the docs link here for, and what only the package page can say.

## Run it

Nothing needs installing first. Until the first release, `latest` is a placeholder, so run the release candidate with `@rc`. In an empty directory named for the Uplink:

```sh
npx @ksp-gonogo/uplink-tools@rc new
npx @ksp-gonogo/uplink-tools@rc --help
```

`new` needs Node and the .NET SDK, and leaves an Uplink whose tests pass. It asks what it was not told, and every question is also a flag, so a script passes them instead. [Your first Uplink](https://ksp-gonogo.github.io/uplink-dev-docs/guide/first-uplink) covers the answers and the files it writes.

The package is published at the one Gonogo release version, with `@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/ui-kit` and the NuGet package `KspGonogo.Sitrep.Contract`. They pin each other exactly, so install them at one version, and move them together. `new` writes every pin. [Building against a release candidate](https://ksp-gonogo.github.io/uplink-dev-docs/guide/release-candidate) covers adding them by hand.

Once the package is in an Uplink's devDependencies, the same commands answer to `uplink-tools` in a `package.json` script. Every command takes `--help` and refuses a flag it does not read.

## The commands

| Command | What it does |
|---|---|
| `new` | scaffold an Uplink and generate, install and write its page; `--no-client` writes the plugin alone, for an Uplink that wraps another mod and has nothing to draw, and with `--topics own` it also writes `types/`, a package of just the generated types of its Topics, for other Uplinks' clients to read them by |
| `add <kind> <name>` | add a widget, augment, contribution, processor, setting or unit to the client from the templates `new` writes, and import it from `client/src/index.ts`; it never overwrites a file |
| `codegen` | write `client/src/__generated__/` (`types/src/__generated__/` when there is no client) from the C# contract slice; `--check` fails on drift |
| `check` | read the client with TypeScript and report what is stale or unresolved, with the command that heals each finding |
| `bundle` | build the client bundle the app loads, and its `gonogo-uplink.json`; `--watch` rebuilds on every change and `--serve <port>` also serves it |
| `bake` | write what the plugin tells the app about its client into C#: where the bundle lives, who wrote it and its hash |
| `package` | lay the built plugin out as `GameData/<name>/` and zip it |
| `release` | `bundle`, `bake`, compile the plugin, check the DLL carries what was baked, and `package`; `release prepare` stamps the version and proves a release builds in a scratch folder; an Uplink with no client runs only the release step |
| `version` | stamp the release version in every place an Uplink writes it; an Uplink with no client has no version to stamp but its types package's `package.json`, and its plugin takes the version from `GONOGO_UPLINK_VERSION` |
| `publish` | copy the released client to where `client.url` is served from, and say the links |
| `deps` | read every dependency the Uplink pins against each channel it is published on; `deps bump` moves the pins that are behind and `deps pin-ckan` writes the CKAN spelling of the pin |
| `page` | write the generated page from what the client registers, with no browser |
| `render` | draw every fixture to `renders/` |
| `docs` | write the page and draw its pictures; `docs --check` fails on drift |
| `story <id>` | draw one Storybook story to a PNG, or to a GIF when the story is tagged `playback` |

[Releasing and installing](https://ksp-gonogo.github.io/uplink-dev-docs/guide/release) covers the release order, and [See your Uplink in the app](https://ksp-gonogo.github.io/uplink-dev-docs/guide/dev-loop) covers `bundle --watch` and `--serve`.

### Declaring the channels a mod publishes on

`deps` reads the `mod` block of `uplink.json`. `channels` lists every place the wrapped mod publishes, CKAN first where it is listed, and a dependency is read on each of them, so one that lags shows as lagging:

```json
"mod": {
  "name": "Kerbcast",
  "tier": "ckan",
  "ckan": "Kerbcast",
  "builtAgainst": "1.11.0",
  "channels": [{ "ckan": "Kerbcast" }, { "github": "ksp-gonogo/kerbcast" }, { "spacedock": 4366 }],
  "packages": ["@ksp-gonogo/kerbcast", "@ksp-gonogo/kerbcast-react"]
}
```

| Kind | Newest means |
|---|---|
| `{ "ckan": "<identifier>" }` | the highest `stable` CKAN-meta entry, by CKAN's own ordering |
| `{ "github": "owner/repo", "tag"?, "asset"? }` | the release GitHub marks latest, never a prerelease; `tag` is a regular expression whose `version` group reads the version from the tag, and `asset` picks the archive a bump downloads |
| `{ "githubTags": "owner/repo", "pattern": "^(?<order>\\d{10})-" }` | the highest `order` among the matching tags, for a mod that releases by tag |
| `{ "spacedock": 1685 }` | the first version SpaceDock lists |
| `{ "npm": "<package>", "distTag"?: "latest" }` | that dist-tag, never the highest version |

`packages` are npm packages that move with the mod, pinned exactly in `client/package.json`. A `ckanDepends` entry may carry `channels` too. `ckanVersion` is the pinned release as CKAN lists it, which is what a CKAN relationship's `min_version` carries. An Uplink on the `ckan` tier should list the CKAN channel, and a pin that names a prerelease is an error in `check` on `main` and a refusal in `release`.

`deps` exits 0 when nothing is behind, 10 when something is and 2 when a channel could not be read. `--json` prints `uplink-deps/1`. `deps bump` runs the Uplink's checks against the new pins and writes an `uplink-bump/1` result (`--result <file>`) with the verdict `green`, `red` or `unverified`, and touches no git.

### Annotating a read `check` cannot name

A read of a Topic chosen at runtime takes a `// gonogo:reads <topic or family>` comment above the call. A frame whose built-in augment does all the reading keeps its `channels` and `fields` with a `// gonogo:augment-reads <augment id> <channel>...` comment above its `registerComponent`, and `check` requires every channel named to appear in that augment's own `channels`.

## What a fixture puts on the stream

A fixture's `_stream` block is the wire its scene is drawn from. [Testing](https://ksp-gonogo.github.io/uplink-dev-docs/guide/testing#fixtures) covers fixtures; this is the detail of each field.

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

| Field | What it does |
|---|---|
| `emits` | replayed once the scene has subscribed, in the order written, or in the order sent under `delaySeconds`. An entry's `validAt` is the game time it was sent; with none it was sent at `pinnedUt` |
| `pinnedUt` | the game time of the operator's view, which the scene is drawn at when it has no `delaySeconds`. Defaults to `1000000` |
| `stopsArriving` | drop the link once every emit has landed, so the picture is of figures that are held |
| `delaySeconds` | a one-way light time between the craft and the screen, in seconds |

With `delaySeconds`, each reading sent at `validAt` is delivered that many seconds later. The view time is the newest `validAt` delivered, with an emit naming none counting as `pinnedUt`, and the craft's present runs one light time ahead of it. Every reading is reckoned to that present as the app does, so a scene can show a modelled figure beside the observed one, drawn with the kit's modelled mark. Without it, or at `0`, the view time and the craft's present are one instant and nothing is carried across.

A reckoner that fits a trend needs more than one reading, so give those emits a history of `validAt`s. A widget that reads the light time off `comms.delay` needs that emitted too: the delay stages the clock, not the Topic. Under a delay an `advanceUt` step moves the craft's present and leaves the view time where it is until something newer is delivered, so a negative `advanceUt` is refused.

## Drawing a widget that extends an app widget

An augment or contribution is drawn inside a widget that ships with the app, so its picture needs that widget around it. Name the host widgets in the client's `package.json`:

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

A fixture then names the widget it extends:

```json
{ "_scene": { "hostWidget": "administration-building" } }
```

`/widgets` exports no symbols: importing it registers the app's own widgets, which is all the harness needs to resolve a scene's `hostWidget`. It is for the generated page only. Name it in `devDependencies` and in `gonogo.renderWith`, never in `dependencies`, and never import it from the client. For a component of it in real use, ask for that component in `@ksp-gonogo/ui-kit`.

The harness draws a scene that names no host in a stand-in widget, whose `Panel` draws the widget's `<id>.badges` slot, so a badge contribution needs no host. Every other slot, such as `administration-building.screens`, `space-center-status.facilities` and `astronaut-complex.readouts`, is drawn by the host widget's own body, and a stand-in draws nothing there, so name the real widget.

## Entry points

| Entry | What it is |
|---|---|
| `@ksp-gonogo/uplink-tools` | the harness API and the `uplink-tools` command's `run`. Node only: esbuild, Playwright and the filesystem |
| `@ksp-gonogo/uplink-tools/render-probe` | the browser half, which mounts a widget in the page the harness builds |
| `@ksp-gonogo/uplink-tools/page-check` | the assertion an Uplink's own suite runs to keep its committed page current. It needs no Playwright, so an author with no browser can run it |
| `@ksp-gonogo/uplink-tools/widget-facts` | the fact rows of a widget as the generated page lists them |
| `@ksp-gonogo/uplink-tools/widgets` | the app's own widgets, registered, so a scene can name one as its `_scene.hostWidget` |
| `@ksp-gonogo/uplink-tools/widgets.json` | the manifest of those widgets, as data |

An author seldom imports any of these: the command line runs the first, and `page-check` is the one a test names.

`@ksp-gonogo/ui-kit` is an optional peer dependency, at the version of this package. The harness draws with the kit and its `/grid` and `/testing` entries, and the app widgets behind `/widgets` are built on it.

## Licence

MIT
