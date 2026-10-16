# C4 diagram

`generate.mjs` draws the project's architecture as an interactive [LikeC4](https://likec4.dev)
site, read from the tree, so running it again after a change redraws it. Nothing it writes is
tracked or deployed.

## Run it

```bash
pnpm c4                       # write the model to .c4/model and build the site into .c4/site
pnpm c4 --serve               # write the model and open LikeC4's live preview
pnpm c4 --png <dir>           # also export every view as a PNG (needs Playwright's Chromium: npx playwright install chromium)
pnpm c4 --out <dir>           # build the site somewhere else
pnpm c4 --uplinks <dir>       # read the Uplinks from a gonogo-uplinks clone that is not ../gonogo-uplinks
pnpm c4 --model-only          # write the model and stop
```

LikeC4 runs through `npx` at the version pinned in `generate.mjs`; it is not a workspace
dependency. The site is built with relative paths and hash routing, so to view it serve
the folder with any static server (`npx serve .c4/site`), or run `pnpm c4 --serve`.

## What it reads

- every workspace `package.json` and its `@ksp-gonogo/*` dependencies
- the mod's C# projects, their `ProjectReference`s and the source folders of `Sitrep.Host` and `Gonogo.KSP`
- the generated contract in `mod/sitrep-sdk/src/__generated__` (Topic ids, payload types, command ids, grouped into domains by their first segment)
- every Uplink, bundled under `mod/Gonogo*Uplink` or in a gonogo-uplinks clone beside this repository: its `uplink.json`, `client/gonogo-uplink.json` (the contract and extension API it was built against), `client/docs/widgets.json` and its own generated contract slice

`facts.mjs` holds what the code cannot say: the people and outside services, one-line purposes,
and the runtime arrows (telemetry, commands, signalling, the relayed path). The generator stops
with an error if a fact names an element the model no longer has.

## Reading the diagram

Start at the system context and click a box to open the view inside it.

1. **System context** (`index`): people, gonogo, the Uplinks, KSP and the outside services
2. **Containers** (`containers`): the main screen, the station screen, the relay container, the mod, the published packages
3. **Components**: one view per box with children, such as the main screen's packages, the app shell's modules, the mod's C# projects and the contract's domains
4. **Uplinks** (`uplinkLayer`): every Uplink and the KSP mod it wraps, with the contract and extension API it was built against. Each Uplink opens onto its domains, Topics, commands and widgets. Amber marks an Uplink built against an older contract major

Two views cut across the layers: **Network** (`network`) shows how a station reaches the main screen, and **Packages and projects** (`packages`) shows the import and reference graph.

### Legend

- Green arrow: telemetry, readings flowing towards a screen
- Amber arrow: commands, flowing towards the game
- Blue dashed arrow: signalling (the PeerJS broker and STUN)
- Red dotted arrow: the relayed path through TURN
- Grey dotted arrow: an import or a project reference
- Grey dashed arrow: any other use
- Indigo Uplink: built against the current contract major; amber: an older one

The built site also shows a notation panel for the element shapes and colours.

### Words

The same words are in the description of the system context view.

- **Uplink**: an add-on that brings one KSP mod to gonogo, with a C# half in the game and widgets in the app
- **Topic**: one named stream of readings, such as `vessel.flight`
- **Domain**: the Topics and commands that share a first name segment (`kos.*`)
- **Sitrep**: the code name of the Gonogo mod and its stream
- **Contract**: the wire format between the mod and the app, versioned `major.minor`. An Uplink records the contract it was built against, and the app refuses a different major
- **Extension API**: the version of the SDK and UI kit surface an Uplink's client is built against

The Topics drawn are the ones the generated contract declares. Per-subject Topics an Uplink registers at runtime (such as `kos.run.<coreId>`) are not listed there, so they do not appear; a widget that reads one points at its domain instead.
