# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Sister project

**`~/personal/kerbcast/`** is a from-scratch KSP camera-streaming mod (successor to OCISLY) that gonogo now consumes for camera feeds, it replaced the old OCISLY+relay camera path (removed in `55d3fbd`; the relay no longer carries any OCISLY gRPC/jpeg-js fan-out). gonogo pulls in the `@jonpepler/kerbcast` SDK and the `CameraFeed` widget lives in `@ksp-gonogo/kerbcast`. When working on anything that touches camera feeds or the WebRTC stream-source code, check `~/personal/kerbcast/CLAUDE.md` first, and the full design at `local_docs/ocisly_state_and_rebuild.md`. The two projects evolve in parallel; conventions (Conventional Commits, semver, perf-budget patterns, Steam-Deck-to-MacBook topology) are shared between them.

## Telemetry mod: brand "Gonogo", codename "Sitrep"

The new first-party KSP telemetry mod (a from-scratch replacement for the Telemachus fork) is **branded Gonogo**, it ships on CKAN/SpaceDock and in-game as `gonogo-*` (e.g. `gonogo-core`, `gonogo-scansat`), keeping the app + mod + extensions one unified ecosystem. Its **engineering codename is "Sitrep"**, used *only in code* to disambiguate the mod from the app (both were "Gonogo"). So: C# `Sitrep.Contract`; npm `@ksp-gonogo/sitrep-sdk` (generated typed contract) + `@ksp-gonogo/sitrep-client` (app-side spine + hooks). **Folder rule:** `mod/` = the mod (C# + the generated `sitrep-sdk`, and future bundled extensions); `packages/` = the app (incl. `@ksp-gonogo/sitrep-client`, and the app's own `@ksp-gonogo/core`, which is untouched; do not confuse it with the mod). Sitrep must **never** appear on end-user surfaces (CKAN/GameData/UI/user docs = Gonogo). Design + milestone plans live in `local_docs/telemetry-mod/` and `docs/superpowers/plans/2026-07-06-telemetry-*` (both gitignored).

## Project Vision

**gonogo** is a mission control SPA for Kerbal Space Program. It operates in two modes within the same app:

- **Main screen** (`/`): connects to KSP data sources, hosts a live telemetry dashboard, and distributes data to connected station screens via PeerJS.
- **Station screen** (`/station`): a peer-connected dashboard whose layout and role are stored in `localStorage`. Stations can optionally pull a saved config from the main screen. There are no per-station routes; each device at `/station` is its own independent station.

The defining feature is a **context-aware, extensible dashboard component system**: components self-register into a global registry, and the dashboard orchestrator renders whatever is registered. External packages (not in this repo) can add components and themes using the same API as the built-in library.

---

## Monorepo Structure

```
packages/
  core/      : Plugin registry, shared TS types, React contexts, GO/NO-GO system
  components/: Built-in dashboard component library (uses core registry)
  serial/    : Serial input platform: device types, transports, render styles,
                InputDispatcher, VirtualDevice widget + UI (see Serial section below)
  ui/        : Private, app-side UI: dashboard chrome, settings-modal furniture,
                PeerJS banners, plus one-line re-exports of ui-kit primitives
  ui-kit/    : The PUBLISHED design system. The only UI package an Uplink may
                import (see UI Components below)
  theme/     : Private. The typed theme contract, the default dark theme, and
                the design tokens behind it; inlined into ui-kit's dist
  data/      : Private. Series-shaped reads over the telemetry store
                (`useDataSeries`, the plotted/sparkline path)
  sitrep-client/: Private. App-side spine + hooks over the Sitrep stream
  logger/    : Private. ConsoleLogger, the log ring buffer and the tag registry
                (see Logs (Axiom) below)
  test-utils/: Private. Shared test helpers
  app/       : Vite + React SPA (main screen + station mode)
  relay/     : Fastify server hosting the /ice-config endpoint, a coturn
                TURN/STUN child process with a per-restart-rotated shared
                secret, the host-discovery registry (/host) mapping a
                stable share-code to the host's current PeerJS peer id,
                and /bootstrap-config republishing the bundle's KSP_HOST
                so the SPA can seed data-source defaults on first run

mod/         : The Gonogo mod (C#) and the generated `sitrep-sdk`, plus each
                bundled Uplink and the client TS it ships. See the folder rule
                in the Sitrep section above
```

**Tooling:** pnpm workspaces + Turborepo. Package names use the `@ksp-gonogo/` scope. Only `@ksp-gonogo/sitrep-sdk` and `@ksp-gonogo/ui-kit` are published; every other workspace package is `private: true` and unreachable by a third-party Uplink.

---

## Workflow

Solo-developer repo. **`staging` is the integration branch and the default target**: it is what `origin/HEAD` points at, and it is where all work lands. Small work goes straight onto `staging`, no pull requests. Large features get a branch cut from current `origin/staging` and folded back in.

`main` is NOT the working branch and has not moved since 2026-07-13; `staging` is 1250 commits ahead of it. Never commit to `main`, and never treat "push to main" advice in an older doc as current.

`deploy.yml` still gates on `main` (`branches: [main]`), so nothing has deployed while work has been landing on `staging`. That is a known state and the operator's call to change, not something to fix in passing.

If a Claude Code session opens with an auto-assigned working branch (e.g. `claude/<task-slug>`), treat this note as the user's standing override: check out `staging` and proceed there.

## Commits

Do not add a `Co-Authored-By: Claude …` (or any other Claude/Anthropic attribution) trailer to commit messages in this repo. Write the commit message as if a human authored it.

## Commands

```bash
pnpm install          # install all workspace dependencies
pnpm dev              # run app (Vite) and the relay container in parallel
pnpm build            # build all packages via Turborepo
pnpm test             # run tests across all packages
pnpm lint             # lint all packages
pnpm --filter @ksp-gonogo/app dev       # run only the SPA
pnpm --filter @ksp-gonogo/core test     # test a single package
```

### Helper scripts

`scripts/gonogo_claude_tools.sh` bundles purpose-scoped helpers that work without per-call permission prompts (the wrappers are already allow-listed in `.claude/settings.local.json`). Prefer the script over ad-hoc `curl`/`ilspycmd`/`dotnet build` calls, every subcommand pins the right paths, host, and timeouts.

Subcommands:

- **`./scripts/gonogo_claude_tools.sh decompile <Type> [<Type>...]`**: dump KSP type signatures (with smart fallback across DLLs and a bare-name → FQN auto-resolve). Capped at 80 lines per type, fine for small classes, truncates on the big ones. Use `members` when you hit the cap.
- **`./scripts/gonogo_claude_tools.sh members <Type> [<Type>...]`**: list every public member of a type by line-range scan of the cached full disassembly. No per-type cap; nested-class members are included. Designed for new-TelemetryAPI scoping where you need to see *every* field the underlying KSP type exposes (Part has 660+ lines of public members, Strategy has ~50). Run after at least one `decompile` or `findtype` for the same type this session so the cache exists.
- **`./scripts/gonogo_claude_tools.sh dump <Type> [<Type>...]`**: full ilspycmd output (method bodies, fields). Use when you need to see what a method does, not just its signature. For "what fields does this type have" prefer `members`, `dump` re-runs ilspycmd per call instead of reading the cache.
- **`./scripts/gonogo_claude_tools.sh findtype <Name>`**: resolve a simple type name to its fully-qualified form. First call per session is ~30s/DLL; subsequent calls hit the textual cache.

Prefer `run_in_background: true` for anything that touches the network or `ilspycmd`, both of which are slow enough to be worth getting off the critical path.

---

## Architecture

### Data Flow

```
KSP + Gonogo mod (Sitrep telemetry, WS)  ──→ Main screen (direct, ws://<host>:8090)
KSP (kOS)                                ──→ Gonogo mod kos.run / kos.processors Uplink
                                                  └──→ Main screen (same WS stream)
Main screen ←──→ Station screens (PeerJS data channels, via peerjs.com broker)
```

The Gonogo mod (`GameData/Gonogo/`, engineering codename "Sitrep") is the app's sole telemetry source as of `806e7fe2`, the browser opens a `WebSocketTransport` straight to it (`SitrepTelemetryProvider`, `packages/app/src/telemetry/`), no HTTP polling, **on by default, no flag required**. Host/port resolve at runtime through `sitrepRuntime.ts`, in priority order: a saved **Settings → Data Sources → Sitrep Stream** config, then a `KSP_HOST` bundle seed (`seedKspHost.ts`, same as kOS/kerbcast), then the `VITE_SITREP_HOST`/`VITE_SITREP_PORT` build-time floor (default `localhost:8090`). The Sitrep Stream row is a thin `DataSource` front (`packages/app/src/dataSources/sitrep.ts`) that reuses the generic Data Sources panel for its config form and connected/disconnected pill, it carries no topics itself; those still route through `SitrepTelemetryProvider`'s `TelemetryClient` context.

The old Telemachus `DataSource` (`ws://host:8085/datalink`) that used to serve this role is deleted, and so are the `build telemachus` and `tele read/action/subscribe` helpers that probed it by hand. Nothing in the repo talks to it.

kOS integration now rides the same Sitrep WS stream as telemetry, script dispatch over the `kos.run` command, CPU discovery over the `kos.processors` channel, so there is no separate proxy process. kOS features simply degrade gracefully when no stream is mounted.

### `@ksp-gonogo/core`

The foundation for everything extensible:

- **Plugin registry**: `registerComponent(def)`, `registerTheme(def)`, and `registerDataSource(def)` are the three extension points. Calling these at module load time is all that's needed to extend the app.
- **Shared TypeScript types**: `ComponentDefinition`, `ThemeDefinition`, `ComponentBehavior`, `DataSource`, `DataRequirement`, etc.
- **GO/NO-GO system**: aggregates the human GO/NO-GO readiness state across all active stations. It is a human readiness ceremony (operators voting) that triggers a stage transition and nothing else; no component feeds into it (`behaviors: ['gonogo-participant']` is inert by design).
- **Data source interface (repository pattern)**: all data sources implement a common `DataSource` interface:
  ```ts
  interface DataSource {
    id: string;
    name: string;
    connect(): Promise<void>;
    disconnect(): void;
    status: DataSourceStatus; // 'connected' | 'disconnected' | 'reconnecting' | 'error'
    schema(): DataKey[];
    subscribe(key: string, cb: (value: unknown) => void): () => void;
    onStatusChange(cb: (status: DataSourceStatus) => void): () => void;
    execute(action: string): Promise<void>;
    configSchema(): ConfigField[];
    configure(config: Record<string, unknown>): void;
    getConfig(): Record<string, unknown>;
  }
  ```
- **`useTelemetry(topic)`** is the universal read hook. It lives in `@ksp-gonogo/sitrep-sdk/spine` and `@ksp-gonogo/core` re-exports it, so both import sites work. Keyed by a typed `TopicId`, it returns that Topic's `Reading`, not a bare payload: reaching a value requires branching on how current it is, which is the whole point of the type. Components never call `getDataSource()` or any `DataSource` method directly.
  - **There is no `useDataValue`.** It was the historical name and it is gone: no definition, no export, no call site. `import { useDataValue } from "@ksp-gonogo/core"` is a compile error (TS2305). Roughly sixty comments across the tree still mention it, correctly, as "the retired `useDataValue` shim"; that is history, not a live API. Any doc telling you to call it is stale.
  - A two-arg legacy form, `useTelemetry(dataSourceId, key)`, is what survives of that shim for reaching a non-Sitrep `DataSource` (kOS, camera, serial). It is a **compile error** through `@ksp-gonogo/sitrep-sdk/spine`, every production caller having migrated, and is declared only on the SDK's published root barrel for an Uplink reading a legacy flat key. It goes away with the shim at M4; do not write new code against it.
  - There is no write twin: `useExecuteAction` was deleted once its last two callers migrated (a ratchet in `packages/core/src/styleguide-delay-ux.test.ts` keeps it deleted), and every command goes through the delay-aware `useCommand(topic)`.

### `@ksp-gonogo/components`

The built-in component library. Each component file calls `registerComponent()` on import, there is no central index that manually lists them; the orchestrator just needs to import the package and registration happens automatically.

Components declare the Topics they mount on through `defineTopicManifest` (`channels`, `optionalChannels`, and `fields` for what the widget actually draws), which also yields the bound `useTelemetry` hook, so declaration and read cannot drift. `dataRequirements` is the legacy flat-key form of the same idea: it still exists on `ComponentDefinition` and coexists during migration, but new widgets use the manifest.

Components are styled with **styled-components**. Component names and styled sub-components follow BEM-inspired naming for readability (e.g. `AltitudeGauge`, `AltitudeGauge__Label`, `AltitudeGauge__Value`).

### `@ksp-gonogo/app`

The Vite SPA. Key responsibilities:

- **Dashboard orchestrator**: a layout engine built on [React Grid Layout](https://github.com/react-grid-layout/react-grid-layout) (`ResponsiveGridLayout`) that reads the current layout config and renders registered components by ID. It does not hardcode any component, it only knows about the registry. Positions are stored in **grid units** (column/row spans), not pixels, so layouts are resolution-independent. The serialised layout format stores a per-breakpoint map (`lg`, `md`, `sm`, etc.) so the grid reflows across screen sizes. Per-instance component config is stored alongside the layout.
- **Sitrep telemetry client**: `SitrepTelemetryProvider` mounts a live `WebSocketTransport` to the Gonogo mod (see the Data Flow section above). Components declare the Topics they mount on the same as before; `useTelemetry` routes mapped, carried topics through the stream automatically.
- **kOS integration** lives entirely in the kOS Uplink (`mod/GonogoKosUplink/`), not in `packages/`, and rides the Sitrep stream: `KosDataSource.executeScript` dispatches over the `kos.run` Uplink command and correlates the `kos.run.<coreId>` result; CPU discovery comes off the `kos.processors` channel (`KosCpuDiscovery` stands up the standing subscription; `onProcessorsChanged` feeds the CPU registry). If no stream is mounted, kOS features degrade gracefully.
- **PeerJS integration**: the main screen acts as the peer host. Stations connect as peers. The main screen distributes a serialised snapshot of data to all peers; stations can also send state back (e.g. GO/NO-GO votes).
- **Station config**: localStorage-first. Stations can request a config from the main screen over PeerJS; the main screen can push saved configs to connecting stations.

---

## Extension Pattern

Both components and themes follow the same self-registration pattern. Note the import specifier: an outside author installs `@ksp-gonogo/sitrep-sdk`, never `@ksp-gonogo/core`, which is `private: true` and on the isolation gate's forbidden list. Every bundled Uplink imports it that way.

`id`, `name`, `description`, `tags` and `component` are required; everything below them is optional.

```ts
// An external npm package can do this:
import { registerComponent, useTelemetry } from '@ksp-gonogo/sitrep-sdk';

registerComponent({
  id: 'my-custom-gauge',
  name: 'My Custom Gauge',
  description: 'Shows the thing.',
  tags: ['telemetry'],        // free-form; the UI styles known values
  component: MyCustomGauge,   // reads with useTelemetry('vessel.state')
  channels: ['vessel.state'], // Topics this widget mounts on
  defaultSize: { w: 4, h: 4 },
  behaviors: [],              // opt-in behavior flags
  defaultConfig: {},
});
```

`defineTopicManifest` (the bound-hook form used by the built-in library) is exported from `@ksp-gonogo/core` only and is **not** reachable from the SDK, so an Uplink declares `channels` directly and calls the free `useTelemetry`, as every bundled Uplink does.

```ts
import { registerTheme } from '@ksp-gonogo/sitrep-sdk';

registerTheme({
  id: 'retro-nasa',
  name: 'Retro NASA',
  theme: { colors: { ... }, fonts: { ... } }, // passed to styled-components ThemeProvider
});
```

The built-in `@ksp-gonogo/components` package models this pattern exactly, it is not treated as special by the orchestrator.

---

## Testing Philosophy

Prefer tests that mock as little of the system as possible. Use [Mock Service Worker (MSW)](https://mswjs.io/) to intercept at the network boundary rather than mocking modules.

- **Integration tests** (in `@ksp-gonogo/app`) use MSW WebSocket/HTTP handlers to simulate KSP APIs. The real data source, real hook, and real component all run, only the network is intercepted. This is the preferred form for tests involving connection status or data flow.
- **Unit tests** (in `@ksp-gonogo/core`, `@ksp-gonogo/components`) use the real registry with simple disconnected fixture data sources. No `vi.mock()` of internal modules. MSW is only needed when a test actually triggers a network call.
- Avoid mocking `useDataSources` or other core hooks in component tests, render the real component with real registry state instead.
- **`act()` warnings are always our bug**; never dismiss them. Three causes, measured across the whole tree in August 2026, not two:
  1. **A long await in the test body** while a live component keeps updating. The commonest instance by far is the `jest-axe` smoke assertion, see Accessibility below; a deliberate `setTimeout` to prove a steady state is the other.
  2. **An async settle landing after the test body returns**: a socket handshake, a `MutationObserver` callback, a stub transport answering a command, a `useDataSeries` backfill query. It reads like a missing `act` in the body and is not; the fix is `await act(async () => {})` at the end of the body, which holds the scope open across the microtask that carries the update.
  3. **Shared state cleared while the tree is still mounted**, so `useSyncExternalStore` subscribers re-render outside `act`.
  Use `waitFor` rather than `act` for assertions on async external events (WebSocket, PeerJS).
- **Tell 1 from 2 and 3 with a marker**, rather than guessing: `console.info("MARKER")` as the last line of the test body, run with `--reporter=verbose`, and see which side of it the warning lands on. Before the marker is in-body, after it is teardown, and the two want opposite edits. This found two of the three causes above.
- **Do NOT add an explicit `cleanup()` to win a teardown race.** RTL registers its own auto-cleanup and it already runs; reaching for a manual one makes the test depend on framework hook ordering that we neither control nor wrote down. If a clear in `afterEach` is notifying a mounted tree, first check whether the clear is needed at all: the registry lives on the test file's own `globalThis` and vitest isolates per file, so there is no cross-file pollution to defend against, and `registerComponent` only throws on a *differing* name. Measured on 13 files: 4 clears were pure harm, 2 were load-bearing, 7 changed nothing.
- **`pnpm test` cannot show you an act warning.** Vitest 4's default reporter suppresses console output for tests that PASS, and an act warning does not fail the test that emits it, so the normal path prints none of them and always has. `--silent=false` looks like the flag and changes nothing; `--reporter=verbose` is the one that works. To see them for one package: `pnpm --filter <pkg> exec vitest run --reporter=verbose`.
- **A count measured on a loaded machine is a MAXIMUM, and a low count on a quiet one is not evidence of absence.** Contention does not hide these races, it gives them more chances to fire: one file measured 0, 1 and 21 across runs of an unchanged tree, the 21 at load 21. The gate prints the load beside the count for this reason.
- **The ratchet is `pnpm act-warning-gate`**, with per-file counts in `scripts/act-warning-debt.mjs` and its own CI job (`act-warnings`). **That list is now empty and the tree is at zero**, so the gate fails on the first warning any file emits. It stays a CEILING rather than an equality: an entry added back fails on growth and only REPORTS a count that came in low, because the quantity is not stable enough to fail on a drop. After a real fix, tighten the entry in the same commit with `pnpm act-warning-gate --update --only <substring>`; a bare `--update` rewrites every entry from one measurement and will write down that run's roll for files you never touched. An entry carrying a comment is never lowered automatically, because a comment marks a number that was chosen rather than measured. The gate plants a deliberate violation and fails as BLIND if it cannot see it, because a counter that cannot see a warning reports zero and zero reads as success.

---

## kOS integration

kOS lives entirely in its own Uplink, `mod/GonogoKosUplink/` (C# mod plus the client TS it ships). Nothing kOS-specific remains in `packages/`. It rides the Sitrep telemetry stream, there is no separate proxy process, and kOS features degrade gracefully when no stream is mounted.

**There is no centralised kOS script registry.** `registerKosScript` / `getKosScripts`, the `shared/scriptRegistry.ts` that held them, and the `KosComputeManager` that fanned their output out as `kos.compute.<id>.<field>` keys were deleted as dead code once the feed-style widgets that were their only consumers were removed. The shared UI-authoring chrome went with them: `KosScriptFrame`, `KosCpuPicker`, the kos-cpu-registry chrome provider, `useKosScriptPayload` and `useKosScriptStatus` are all gone. So are the widgets themselves (`KosProcessors`, `KosFiles`, `KosScriptRunner`, `KosWidget`, `KosWrapperTester`). If you find a recipe anywhere that calls `registerKosScript`, it cannot be followed.

The `kos.compute.<id>.<field>` namespace is still identity-mapped in `map-topic.ts` against a future compute-feed slice, but nothing produces values on it today. Reading one gets you `undefined` forever.

### What actually exists

- **`KosDataSource`** (`mod/GonogoKosUplink/client/src/dataSource/kos.ts`): a plain RPC client. It holds no persistent socket and carries no subscribable data keys of its own, so it is registered via `registerUplinkHandle("kos", kosSource)` rather than `registerDataSource`, and never appears in the generic Data Sources panel. kOS health surfaces mod-side through `IUplinkHealthReporter` (`KosHealth`).
- **`executeScript(cpu, script, args, managed?)`**: runs a script on the named CPU over the `kos.run` Uplink command, correlates the `kos.run.<coreId>` result, and resolves with the parsed `[KOSDATA]` object. Calls to one CPU are serialised by a per-core FIFO queue; different CPUs run in parallel. Pass `managed` to have the dispatch wrapped in a check-and-write preamble that keeps the on-volume copy in sync with the bundled body, versioned against a `<script>.ver` sidecar.
- **CPU discovery**: `onProcessorsChanged(cb)` subscribes to the mod's native `kos.processors` push channel and replays the current snapshot on subscribe. `KosCpuDiscovery` mounts it and maps `procs.map(p => p.tag)` into the CPU registry.
- **`KosTerminal`**: the one surviving kOS widget, and the valuable surface. It uses none of the deleted feed pattern, it reads `kos.processors` and the terminal frame stream directly.
- **PerfBudget**: `KosDataSource.executeScript dispatches/sec`, threshold 10. Each run holds a CPU's REPL for hundreds of ms, so a sustained rate above ~5/sec means widgets are stomping each other.

### Writing a new kOS-driven widget

The RPC one-shot is the only pattern available: call `kosSource.executeScript(...)` directly and own the call's lifecycle yourself (when to fire, caching, error surfacing). `useKosScriptListing` (`KosTerminal/useKosScriptListing.ts`) is the reference implementation and worth reading first, it is lazy, single-shot, caches per `(coreId, cpuTag)`, and degrades to an empty result plus a human hint on every failure mode rather than throwing.

The kerboscript still emits a topic-tagged block that the `[KOSDATA]` parser reads:

```
PRINT "[KOSDATA:my-op]paths=" + json + "[/KOSDATA]".
```

If you want a passive, on-interval, no-args feed shared by many subscribers, that mechanism does not currently exist. Build the RPC call, or restore the compute slice deliberately, rather than writing against the deleted registry.

---

## CI/CD

- `.github/workflows/ci.yml`: runs on pushes to `main`, `ci-dev` and `staging`, and on PRs targeting `main` or `staging`. Three jobs run in parallel: `test` (lint + `pnpm test`), `e2e` (Playwright, matrixed chromium/firefox/webkit), and `visual` (the per-engine visual regression gate, matrixed the same way; see below).
- `.github/workflows/uplink.yml`: one leg per Uplink, **discovered** by `scripts/uplink-matrix.mjs` rather than hand-listed. Each leg builds, tests, typechecks and lints its own Uplink, and runs the **extraction probe** (`scripts/uplink-extraction-probe.mjs`), which materialises the client OUTSIDE the pnpm workspace and checks it against the PUBLISHED `sitrep-sdk` and `ui-kit`. That is the only check that means "this Uplink can leave": the isolation ratchets gate imports, and the build still resolves through workspace links, so an Uplink can pass every gate and depend on API that was never published. Non-blocking for now (`continue-on-error`), running alongside `ci.yml` rather than replacing it. Debt lives in `scripts/uplink-extraction-debt.mjs` and is **empty**: a new Uplink is held to zero.
  - It asks four things, and three of them are not typechecks, because a typecheck-only probe reported zero errors while the published sdk could not be imported at all: (1) a control typechecks clean under **both** `moduleResolution: bundler` and `nodenext`, (2) every published entry point **LOADS** in a bare `node` import, (3) the types it typechecked against came out of `dist` and not the `src` the sdk also ships, (4) each of those can be seen to FAIL, via a planted bad export and a planted missing subpath.
  - **Bare `node`, never vitest, is the load gate.** A consumer needs `server: { deps: { inline: [/@ksp-gonogo/] } }` for `ui-kit` (see below), and that setting makes Vite do the extension search Node refuses to, so it PASSES a package that cannot be loaded. A green vitest run is not evidence the sdk is loadable.
  - `RUNTIME_IMPORT_EXEMPT` in the debt file names the entry points that legitimately do not load under bare `node`, each with its cause. All five are `@ksp-gonogo/ui-kit`: it evaluates `styled.span` at module scope and `styled-components@6` ships no `exports` map, so bare Node loads its CJS half and the default export arrives as the namespace rather than the factory. Nothing in this repo can fix that from the kit's side; the consumer's `deps.inline` is the fix.
  - It measures what a release WOULD publish and structurally cannot see what IS published, which is how a one-key `exports` map and an unloadable `dist` sat on npm from 2026-07-11 while every gate stayed green. Nothing covers that gap yet, and it cannot be covered from `ci.yml`: between a version bump and the release that publishes it the registry copy is correctly behind, so a parity check on every push would be a second permanently-red job. It belongs immediately after `npm publish`, and is not built.
  - The Uplink plugin ASSEMBLIES are compiled by `scripts/uplink-mod-build.sh` as a step of `ci.yml`'s `mod` job, not here.
- `.github/workflows/deploy.yml`: triggers on `workflow_run` (CI passes on `main` only). **Channel model:** every main push deploys only the DEV channel (`https://ksp-gonogo.github.io/gonogo/dev/`, images tagged `:dev`, app version `X.Y.Z-dev.<shortsha>`); the root site (`/gonogo/`) and `:latest`/`:<version>` images move only when a release is cut via `gh workflow run prepare-release.yml --ref main` (→ `release.yml`). The version in `packages/app/package.json` changes ONLY through that flow; never bump it by hand. Details in `docs/DEPLOYMENT.md`. GitHub Pages source must be set to **GitHub Actions** in repo settings.

### Visual regression gate

The `visual` CI job renders every widget through the probe harness (`packages/components/scripts/visual-gate.ts`) and diffs each render against a committed **per-engine** baseline under `packages/components/visual-baselines/<engine>/` (`pixelmatch`, 0.2% ratio). It is per-engine, never cross-engine, engines rasterise differently.

**When the `visual` job goes red** (the job log prints the exact fix command):

1. Download the `visual-diffs-<browser>` CI artifact: it contains `baseline / actual / diff` PNGs for each failing render. Decide whether the change is intended.
2. **Intended change** → regenerate the baselines. They MUST be generated on Linux (font rasterisation is OS-specific; never commit locally-rendered macOS baselines):
   ```
   gh workflow run update-baselines.yml --ref <branch> [-f widget=<id>]
   ```
   That `workflow_dispatch` job renders on the CI runner and commits the new baselines back to the branch. Scope it to one widget with `-f widget=<id>`.
3. **Unintended change** → it's a real cross-browser regression; fix the widget.

Notes: the gate **soft-passes** (warns, exits 0) when an engine has *no* baselines yet, so first-land and bootstrap stay green. Determinism depends on the harness pinning `Date.now()` and disabling animations, a new time-based or animated widget may need matching handling. Bumping the `playwright` version changes rasterisation and requires a baseline regen. Run locally with `pnpm --filter @ksp-gonogo/components visual-gate --engine <e> [--update] [--widget <id>]`.

---

## Logs (Axiom)

Production logs from the deployed app stream to Axiom. The project-scope MCP server (`.mcp.json`) gives Claude Code direct query access, first call in a new session triggers OAuth in the browser.

- **Dataset:** `gonogo`
- **Query language:** APL (Kusto-flavoured, run via the `axiom` MCP)
- **Retention:** 30 days (free tier)
- **Source:** every entry the in-app `ConsoleLogger` emits is fanned out to Axiom in addition to the browser console + ring buffer. See `packages/core/src/logger/`.
- **Build wiring:** `VITE_AXIOM_TOKEN` is set as a GitHub Actions secret and passed through in `deploy.yml`. Without the secret, the transport silently doesn't install, local dev never hits Axiom.

### Entry shape

Top-level fields you can filter on:

- `level`: `debug` | `info` | `warn` | `error`
- `message`: human string (already prefixed with `[tag]` if tagged)
- `tag`: optional verbose-tracing tag (`peer`, `peer:ice`, `peer:kos`, …)
- `device.role`: `host` | `station` | `unknown`
- `device.id`: host short id (e.g. `XK3F`) or station UUID (`stationKey`)
- `device.peerId`: broker peer id (host: same as `id`; station: `station-<key>-<sessionToken>`, fresh each page-load)
- `device.hostPeerId`: for stations: which host they're connected to
- `sessionId`: fresh UUID per page load (groups everything from one tab)
- `context`: free-form bag set at the call site
- `error.{name,message,stack}`: when applicable

### Starter queries

```kusto
// Last 50 errors, by who emitted them
['gonogo']
| where level == "error"
| sort by _time desc
| take 50
| project _time, ['device.role'], ['device.id'], message, ['error.message']

// Everyone in a session with host XK3F right now
['gonogo']
| where _time > ago(10m)
| where ['device.role'] == "station" and ['device.hostPeerId'] == "XK3F"
| summarize last_seen = max(_time) by ['device.id'], ['device.peerId']

// Full trail of one tab session
['gonogo']
| where sessionId == "<paste sessionId>"
| sort by _time asc
```

### Investigating an issue

1. Get the `device.id` (or `sessionId`) from the user / log line.
2. Pull all entries for that device in the relevant window.
3. If it's a peer/connection bug, also pull the *other* side's log, the host's view of the same `peerId`, or the station's view of the same `hostPeerId`.
4. Verbose tracing tags (`peer:ice`, `peer:kos`) are off in console output by default but always shipped to Axiom; check those first when chasing a peer/connection issue.

### When NOT to use

- For a live debugging session against your own browser, the in-page `localStorage` ring buffer + `logger.exportLogs()` is faster (no round-trip).
- For long-tail post-mortems and "what did the other user see", Axiom.

---

## UI Components

Basic, reusable UI elements (toggles, inputs, buttons, tags, etc.) belong in a shared package, not co-located with the feature that first needs them. If a primitive doesn't exist yet and you need it, add it there rather than creating a local one-off. Duplication in files you're not actively editing is easy to miss; a consistent home prevents that.

**Which package: `@ksp-gonogo/ui-kit` is the default.** It is the *published* package, so it is the only one a third-party Uplink can import. Anything an Uplink might plausibly want (every layout primitive, badge, readout, form control, the Panel family) goes there. `@ksp-gonogo/ui` is private and app-side: it holds only what an Uplink has no business reaching (dashboard chrome, the settings modal's furniture, PeerJS banners). When a primitive lives in ui-kit and the app wants the short import too, `packages/ui/src/X.tsx` becomes a one-line re-export; a dozen files already are.

**Never implement the same name in both.** `styleguide-duplicate-primitives.test.ts` fails the build if you do, and names the two files. It exists because `Panel` was copied into ui-kit instead of aliased when that package was created: the copies drifted, `panelTitle` became a type error from one of them, and ui-kit's `PanelBody` silently clipped where the other scrolled, across 29 widgets. `Badge` was going the same way and was caught by the guard.

---

## Uplink isolation: an Uplink imports only the PUBLISHED packages

`mod/Gonogo*Uplink/client/**` may import **`@ksp-gonogo/sitrep-sdk`** and
**`@ksp-gonogo/ui-kit`** (plus `react`, `styled-components`, third-party), and
nothing else from this repo. `core`, `ui`, `components`, `data`, `logger` and
`sitrep-client` are private and unpublished: an outside author cannot install or
build against them. Note `ui` and `ui-kit` are different packages.

**There is no first-party exemption.** Some Uplinks ship bundled with the mod;
that changes how they are distributed, not what they may import. Every Uplink in
this repo is meant to be a working example of what an outside author can build,
and one that reaches into the app is not.

The app's baked import map (`packages/app/src/uplinks/externals/`) resolves fifteen
specifiers at runtime, `core` included. **That is not a licence to import them**,
it fixes runtime resolution only and does nothing for building. The permitted sdk
subpaths are `/frames`, `/media` and `/testing`; `/spine` and `/registry` resolve
at runtime for first-party code and are not author surfaces.

A **subpath** needs its own entry in that map. It matches keys exactly, and
esbuild externalises a subpath of an externalised package name, so a missing
entry survives typecheck, the isolation ratchet and the build itself, then throws
at `import(bundleUrl)`. That is how `/spine` shipped unresolvable. See that
directory's README for the two checks that now cover it.

If something you need is missing from the SDK, **move the export into
`sitrep-sdk` or `ui-kit`**, don't import across the boundary. Never put a
repo-wide gate inside an Uplink: a check needing an app-internal package is one a
third-party author cannot run.

**The C# side is the same rule.** `mod/Gonogo*Uplink/*.csproj` may reference
`Sitrep.Contract` and its own `<Uplink>.Contract` slice, nothing else of this
repo's. ProjectReference is transitive, so what counts is the assemblies you can
*reach*, not the lines you wrote. If an Uplink needs to call into core, declare the
interface in `Sitrep.Contract` and resolve the implementation through
`host.Kernel`, do not reference the assembly.

Enforced by `packages/core/src/uplink-isolation.test.ts` (client half, shrink-only
debt list, seeded 2026-08-18) and `mod/Sitrep.Core.Tests/UplinkIsolationTests.cs`
(C# half; its Uplink debt list is EMPTY as of 2026-08-20, keep it that way).

**A `<Uplink>.Tests` project is held to the same rule**, because it moves with
its Uplink: it names that Uplink's types and compiles its sources, so an Uplink
whose suite only builds against private assemblies has not been made extractable.
That half was outside the walk until 2026-08-30, which is how every list here
read zero while ten of the twelve test projects reached one. Its debt lists
(`TestProjectReferenceDebt`, `TestProjectImportDebt`) are seeded and shrink-only;
all ten reach `Sitrep.Contract.TestSupport` (unpublished, `IsPackable=false`),
five of them also reach `Sitrep.Host` or `Sitrep.Core`. Full rules
and the reasoning: `docs/uplink-isolation.md`.

---

## Spending funds: always show the balance

Any widget that exposes an action which spends career funds (launch a craft, upgrade a facility, accept an advance, unlock a tech) **must display the current funds balance somewhere visible in the same widget**. Mount on the `career.status` channel and read the `career.status.economy.funds` field, then surface it next to the spend control, a small "Funds: 289,848f" readout is enough. **Not `career.funds`**: that is a retired flat key, and `defineTopicManifest` rejects it at compile time in both `channels` and `fields` (`packages/core/src/hooks/defineTopicManifest.test-d.ts`). Put the readout in the Panel body rather than its aside, the aside collapses at narrow widths and takes the balance with it. The operator should never be forced to look at another widget to find out whether they can afford the thing they're about to confirm.

Applies to widgets like `LaunchDirector`, `SpaceCenterStatus` (facility upgrades), future Tech Tree, and Strategies/Admin Building. The rule is per-widget, not per-screen, duplicate the readout across widgets that each spend funds rather than relying on a single elsewhere-on-the-dashboard balance.

---

## Accessibility

Baseline expectations for every new or modified component. Targets WCAG 2.1 AA; see the [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/) for the canonical widget patterns.

- Interactive elements are real `<button>` / `<a>` / `<input>`; never `<div onClick>`.
- Every form input has an associated `<label htmlFor>` or is wrapped in a `<label>`.
- Icon-only buttons get an `aria-label`; decorative SVGs get `aria-hidden="true"`.
- Components are fully operable by keyboard. For custom widgets, follow the APG pattern (tablist arrow nav, combobox + listbox, etc.).
- Keyboard focus is visible: use `:focus-visible { outline: 2px solid #00ff88; outline-offset: 2px; }`. Never strip `outline` without a replacement.
- Wrap mission-state changes (e.g. GO/NO-GO transitions) in `role="status" aria-live="polite"`. Reserve `role="alert"` / `aria-live="assertive"` for events that must interrupt (ABORT). Don't live-region streaming telemetry, it floods screen readers.
- Respect `prefers-reduced-motion` on any new animation: the global reset in `packages/app/src/styles/global.css` damps transitions, but indefinite CSS animations (e.g. pulses) need an explicit `@media (prefers-reduced-motion: no-preference)` guard.
- Colour contrast: 4.5:1 for normal text, 3:1 for large text and non-text UI (focus rings, borders).
- Component tests should include the a11y smoke assertion, via the helper:
  ```ts
  import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";

  await expectNoA11yViolations(container);
  ```
  Do NOT hand-roll `expect(await axe(container)).toHaveNoViolations()`. `axe` walks the DOM asynchronously and takes real time, so a widget with a clock or a subscription keeps updating throughout, and awaited bare every one of those updates lands outside `act`. That form was the single largest remaining source of act warnings in the tree: 29 across four files, one of them ranging 0 to 21 per run depending on machine load. The helper does the `act` wrapping once, in one place, so no caller has to know it exists.

---

## Performance Budgets

`@ksp-gonogo/core` exposes a `PerfBudget` class that tracks rolling-window event rates and warns + fails CI when a soft cap is breached. The dashboard widget `Perf Budgets` shows every registered budget live; a global test-gate (`PerfBudget.installTestGate()` wired into each package's `setupFiles`) fails any test that pushes a budget over its threshold. See `local_docs/performance_review.md` for the design and the existing budgets.

**Required: any new data source MUST register a sample-rate or dispatch-rate `PerfBudget`.** Data sources are the highest-frequency surface in the app, a misconfigured WebSocket, a runaway poll, or a duplicated subscription will silently degrade the whole dashboard. The budget catches all three.

What "new data source" means here: any class that implements the `DataSource` interface (added to the registry via `registerDataSource(...)`), and any wrapper that fans samples out to subscribers (e.g. `BufferedDataSource`, `PeerBroadcastingDataSource`, future kOS variants).

What to record:
- For pull-style sources (HTTP polling): `executeScript` / `fetch` / dispatch rate.
- For push-style sources (WebSocket, PeerJS): sample-emit rate (or wire-byte volume if message size varies).
- Pick a threshold ~3–5× the realistic steady-state load. Tight enough to catch a regression, loose enough not to false-positive on a normal burst.

The pattern (from `BufferedDataSource.ts`):

```ts
const MY_SOURCE_BUDGET = new PerfBudget({
  name: "MySource samples in/sec",
  threshold: 1500,
  windowMs: 1000,
  unit: "samples",
});

private handleSample(...) {
  MY_SOURCE_BUDGET.record();
  // ...
}
```

Add the budget at module scope (it self-registers in the global registry on construction). The dashboard widget will pick it up automatically.

## Serial Input Platform

`@ksp-gonogo/serial` is the per-screen serial input layer. It lets a user plug a physical (or virtual) device into a screen, declare its button/analog inputs, and map those inputs onto dashboard-component **actions**.

- **Device types** are user-defined at runtime via the **Serial Devices** menu (joystick FAB, bottom-right of any screen). A type names its inputs, selects a parser (`char-position` is the only one for now), and optionally picks a render style that pipes values back out to the hardware.
- **Device instances** are per-screen (localStorage key `gonogo.serial.devices.<screenKey>`) and come in two transports: `web-serial` (real USB via `navigator.serial`) and `virtual` (in-memory, driven from the **Virtual Device** widget or from tests via `VirtualTransport.inject`). A default `Virtual Controller` type + instance is seeded on first run.
- **Component actions**: every component declares its actions in `registerComponent({ actions: [...] })` and handles them with `useActionInput<typeof actions>({ ... })` inside the component body. Consider actions a core part of any new component, alongside `dataRequirements`.
- **Input mapping**: the dashboard config modal shows an **Inputs** tab whenever a component has actions. Saved mappings live on `DashboardItem.inputMappings` and are consumed by `InputDispatcher`, which routes `{ deviceId, inputId }` events to `dispatchAction(instanceId, actionId, payload)`. Handler return values feed the device's render style and are written back via `transport.write()` on a debounce.
- **Render styles** are code-registered via `registerSerialRenderStyle()`; the built-in `text-buffer-168` (21×8 ASCII) self-registers when `SerialDeviceService` loads. Add new styles alongside it under `packages/serial/src/renderStyles/`.
- **Testing serial flows**: prefer `VirtualTransport` (no Web Serial needed) for most integration tests, and the `MockWebSerial` helper when you specifically need to exercise the `WebSerialTransport` read/write path. Both live in `@ksp-gonogo/serial`.

Serial events stay on the screen where the device is plugged in, they are **not** broadcast over PeerJS. A station that wants physical inputs has its own local devices and mappings.

---

## Key Design Constraints

- **Main screen is the sole KSP data consumer.** Stations never talk to KSP directly; they receive data exclusively from the main screen over PeerJS.
- **kOS is optional, not a core dependency.** kOS rides the Sitrep stream (`kos.run` / `kos.processors`); the app must function (minus kOS features) when no CPU is present or no stream is mounted. Never make kOS a hard startup requirement.
- **PeerJS broker is configurable.** Default to `0.peerjs.com` but expose a config option (environment variable or settings UI) to point at a self-hosted broker.
- **Themes are runtime-switchable.** The ThemeProvider must be driven by the active theme from the registry, not hardcoded at build time.
- **Station identity is localStorage-first.** Never assume a station has a server-side identity. Server-saved configs are a convenience layer on top of a fully local-first station.
