# @ksp-gonogo/sitrep-sdk

The TypeScript SDK for the Gonogo telemetry mod, whose engineering codename is Sitrep. It is the package an Uplink's client imports to register widgets, read Topics and send commands: `defineUplinkClient`, `registerComponent`, `useTelemetry`, `useCommand`, the generated types of the wire contract and the unit model. The command line is `@ksp-gonogo/uplink-tools`, and the components are `@ksp-gonogo/ui-kit`.

**Writing an Uplink? Start with the [Uplink developer docs](https://ksp-gonogo.github.io/uplink-dev-docs/).** The [guide](https://ksp-gonogo.github.io/uplink-dev-docs/guide/) takes you from an empty directory to an Uplink a player can install, and the [reference](https://ksp-gonogo.github.io/uplink-dev-docs/reference/) documents every export of this package. This page does not repeat either.

## Install

Until the first release, `latest` is a placeholder, so install the release candidate with `@rc`.

```sh
npm install @ksp-gonogo/sitrep-sdk@rc
```

An Uplink installs this package with `@ksp-gonogo/ui-kit` and `@ksp-gonogo/uplink-tools` under the same tag, at one version, because the packages pin each other exactly. `uplink-tools new` writes that set for you, and [Building against a release candidate](https://ksp-gonogo.github.io/uplink-dev-docs/guide/release-candidate) covers adding it by hand. React 18 and styled-components 6 are peer dependencies, and `@testing-library/react` is a peer for `/testing`.

## Entry points

| Entry | What it is |
|---|---|
| `@ksp-gonogo/sitrep-sdk` | the authoring surface: registration, the read and send hooks, the wire types, the unit model |
| `@ksp-gonogo/sitrep-sdk/frames` | reference-frame arithmetic |
| `@ksp-gonogo/sitrep-sdk/media` | delayed media: playout buffers that follow the operator's view of time |
| `@ksp-gonogo/sitrep-sdk/testing` | rendering and stream fixtures for a client's tests |
| `@ksp-gonogo/sitrep-sdk/uplink-manifest` | the types of `uplink.json` and of the manifest a client publishes |
| `@ksp-gonogo/sitrep-sdk/uplink-externals` | the specifiers a client bundle leaves for the app to resolve at load |
| `@ksp-gonogo/sitrep-sdk/tsconfig.base.json` | the TypeScript baseline an Uplink extends |
| `@ksp-gonogo/sitrep-sdk/biome` | a Biome config, below |

`/spine`, `/registry` and `/uplink-load` are exported for the app and the tools and are not an author's surface. The reference names every export that is.

## TypeScript baseline

```json
{ "extends": "@ksp-gonogo/sitrep-sdk/tsconfig.base.json" }
```

It sets `strict`, the `bundler` module resolution, `react-jsx` and `skipLibCheck`, which is what the scaffold's `tsconfig.json` extends.

## Lint config

The package ships a Biome config that reports a reach past the supported API as a lint error, so the mistake shows in the editor and not at runtime:

```json
{ "extends": ["@ksp-gonogo/sitrep-sdk/biome"] }
```

`extends` takes an array and merges from the first entry to the last, so your own config wins and you can combine this one with others. The file is named `biome.shared.json` and not `biome.json` because Biome treats a nested `biome.json` as a project config of its own.

## Working on this package

This section is for a maintainer of the Gonogo repository.

`src/__generated__/contract.ts` is written by [Reinforced.Typings](https://github.com/reinforced/Reinforced.Typings) from the C# in `mod/Sitrep.Contract/`, and carries a header saying so. Change the C# class, or `mod/Sitrep.Contract/RtConfig.cs` for what is exported, and regenerate from the repository root:

```sh
pnpm codegen         # rewrites src/__generated__/
pnpm codegen:check   # regenerates, then fails if git sees a difference
```

`codegen` also writes the topic, command, unit and control-channel maps, each with a hand-owned wrapper beside it that is the surface you import:

| Generated | Wrapper | What it answers |
|---|---|---|
| `topic-map.ts` | `src/topics.ts` | which Topics exist, and what each one's payload is |
| `command-map.ts` | `src/commands.ts` | which commands exist, what each one takes, and what a dispatch resolves with |
| `units.ts` and `units.json` | `src/units.ts` | which field carries which unit |
| `control-channels.ts` | `src/control-channels.ts` | which read field pairs with which write command |

`src/envelope.ts` groups the generated message interfaces into the `ServerMessage` and `ClientMessage` unions, which a generator cannot know. `SERVER_TYPE_TAGS` in `src/client.ts` holds the same membership at runtime, and `satisfies Record<ServerMessage["type"], true>` makes `tsc` fail when a variant is added to the union without it.

A change to the types this package publishes is declared in `extension-api.ledger.json`, which a test holds to the computed surface.

## Licence

MIT
