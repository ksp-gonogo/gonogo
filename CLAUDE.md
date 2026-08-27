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
  ui/        : Reusable UI primitives (buttons, inputs, tabs, modal, icons, etc.)
  app/       : Vite + React SPA (main screen + station mode)
  relay/     : Fastify server hosting the /ice-config endpoint, a coturn
                TURN/STUN child process with a per-restart-rotated shared
                secret, the host-discovery registry (/host) mapping a
                stable share-code to the host's current PeerJS peer id,
                and /bootstrap-config republishing the bundle's KSP_HOST
                so the SPA can seed data-source defaults on first run
```

**Tooling:** pnpm workspaces + Turborepo. Package names use the `@ksp-gonogo/` scope.

---

## Workflow

Solo-developer repo. Work directly on `main`, no feature branches, no pull requests. Commit and push straight to `main`.

If a Claude Code session opens with an auto-assigned working branch (e.g. `claude/<task-slug>`), treat this note as the user's standing override: check out `main` and proceed there.

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
- **Shared TypeScript types**: `ComponentDefinition`, `ThemeDefinition`, `DataSourceDefinition`, `StationConfig`, `DataRequirement`, `Behavior`, etc.
- **React contexts**: `DashboardContext` (current layout, orchestrator state), `PeerContext` (PeerJS connection state), `StationContext` (station identity/role from localStorage).
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
- **`useDataValue(dataSourceId, key)`** is the universal read hook for the non-Sitrep `DataSource` sources (kOS, camera, serial). Components never call `getDataSource()` or any `DataSource` method directly. It is the **PeerJS boundary**: on the main screen it calls the DataSource directly; on a station screen (future) it will route through PeerJS instead. The component code doesn't change, only the hook routing does. There is no longer a write twin: `useExecuteAction` was deleted once its last two callers migrated, and every command goes through the delay-aware `useCommand(topic)`.

### `@ksp-gonogo/components`

The built-in component library. Each component file calls `registerComponent()` on import, there is no central index that manually lists them; the orchestrator just needs to import the package and registration happens automatically.

Components declare their `dataRequirements` (e.g. `['vessel.altitude']`) so the orchestrator knows what data to subscribe to. The data layer resolves requirements against registered data sources.

Components are styled with **styled-components**. Component names and styled sub-components follow BEM-inspired naming for readability (e.g. `AltitudeGauge`, `AltitudeGauge__Label`, `AltitudeGauge__Value`).

### `@ksp-gonogo/app`

The Vite SPA. Key responsibilities:

- **Dashboard orchestrator**: a layout engine built on [React Grid Layout](https://github.com/react-grid-layout/react-grid-layout) (`ResponsiveGridLayout`) that reads the current layout config and renders registered components by ID. It does not hardcode any component, it only knows about the registry. Positions are stored in **grid units** (column/row spans), not pixels, so layouts are resolution-independent. The serialised layout format stores a per-breakpoint map (`lg`, `md`, `sm`, etc.) so the grid reflows across screen sizes. Per-instance component config is stored alongside the layout.
- **Sitrep telemetry client**: `SitrepTelemetryProvider` mounts a live `WebSocketTransport` to the Gonogo mod (see the Data Flow section above). Components declare data requirements the same as before; `useDataValue`/`useTelemetry` routes mapped, carried topics through the stream automatically.
- **kOS integration**, rides the Sitrep stream: `KosDataSource.executeScript` dispatches over the `kos.run` Uplink command and correlates the `kos.run.<coreId>` result; CPU discovery comes off the `kos.processors` channel (`KosCpuDiscovery` stands up the standing subscription; `onProcessorsChanged` feeds the CPU registry). If no stream is mounted, kOS features degrade gracefully.
- **PeerJS integration**: the main screen acts as the peer host. Stations connect as peers. The main screen distributes a serialised snapshot of data to all peers; stations can also send state back (e.g. GO/NO-GO votes).
- **Station config**: localStorage-first. Stations can request a config from the main screen over PeerJS; the main screen can push saved configs to connecting stations.

---

## Extension Pattern

Both components and themes follow the same self-registration pattern:

```ts
// An external npm package can do this:
import { registerComponent } from '@ksp-gonogo/core';

registerComponent({
  id: 'my-custom-gauge',
  name: 'My Custom Gauge',
  category: 'telemetry',
  component: MyCustomGauge,
  dataRequirements: ['vessel.altitude'],
  behaviors: [],           // opt-in behavior flags
  defaultConfig: {},
});
```

```ts
import { registerTheme } from '@ksp-gonogo/core';

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

## Centralised kOS scripts

The kOS data source runs registered kerboscripts on the user's active CPU and fans the parsed payloads out to subscribers as standard `kos.compute.<id>.<field>` data keys. One loop per script, regardless of how many widgets subscribe. This is the **default path for any new kOS-driven widget**, `useKosScriptPayload` / `useKosWidget` are reserved for the niche RPC case (per-call args, request/response).

### When to use this vs. raw `executeScript`

- **Centralised feed** (this section): passive listing / telemetry / state snapshot, same payload for every subscriber. Examples: ShipMap parts, KosProcessors listing. The widget calls `useDataValue` and is done. (NOT TargetPicker, its Bodies/Vessels/Parts list is the `target.available` stream Topic, read with `useTelemetry`, not a kOS feed.)
- **Raw `executeScript`**: RPC-shaped one-shots that take per-call args. Examples: KosFiles (op + path → contents). The widget calls `getDataSource("kos").executeScript(cpu, scriptPath, args, managed)` directly. No registry entry, no fanout. (NOT TargetPicker's set-target click, that dispatches the `vessel.target.set` command through `useCommand`, not a kOS script.)

### Adding a new feed-style widget

Three pieces: the kerboscript, the registration, and the widget consumption.

**1. The kerboscript**: emit a topic-tagged `[KOSDATA]` block:

```
PRINT "[KOSDATA:my-feed]parts=" + json + "[/KOSDATA]".
```

The topic id (`my-feed`) must match the `id` you register below. JSON values are passed as JSON-encoded strings; scalars (number / boolean / string) can be emitted directly.

**2. Self-register at module load**, alongside `registerComponent`. Same lifecycle pattern. Put this at the bottom of your `<widget>Script.ts`:

```ts
import { registerKosScript } from "@ksp-gonogo/core";

registerKosScript({
  id: "my-feed",                       // must match [KOSDATA:<id>]
  name: "My Feed",                     // shown in debug surfaces
  script: MY_FEED_SCRIPT,              // kerboscript source
  intervalMs: 5_000,                   // passive cadence (script-defined, not subscriber-driven)
  fields: [
    { name: "parts", type: "json" },   // JSON.parse before delivery
    { name: "count", type: "scalar" }, // pass-through number/bool/string
  ],
});
```

The data source runs the script on `0:/widget_scripts/<id>.ks` via the managed wrapper (auto-syncs the on-volume copy). No script-name config needed.

**3. Read from the widget** with the standard hooks:

```ts
import { useDataValue } from "@ksp-gonogo/core";
import { useKosScriptStatus } from "@ksp-gonogo/data";
import { useCommand } from "@ksp-gonogo/sitrep-client";

const parts = useDataValue<MyPart[]>("kos", "kos.compute.my-feed.parts");
const status = useKosScriptStatus("my-feed");
const dispatchNowCmd = useCommand("kos.dispatchNow");
const reEnableCmd = useCommand("kos.reEnable");
usePanelDelay(dispatchNowCmd);
usePanelDelay(reEnableCmd);

const dispatchNow = () => void dispatchNowCmd.send({ coreId, scriptId: "my-feed" });
const reEnable = () => void reEnableCmd.send({ scriptId: "my-feed" });
```

`useDataValue` carries the value; `useKosScriptStatus` carries `running / lastGoodAt / scriptError / parseError / paused`, bits that don't fit the value channel. The standard `KosScriptFrame` chrome accepts all those props directly.

Add the data key to the widget's `dataRequirements` so the orchestrator's debug surfaces know about it.

### Lifecycle, breaker, sticky cache

- **0 → 1 subscriber** on a topic starts the loop. **1 → 0** schedules teardown after a 5s grace so React StrictMode remounts don't churn the dispatcher.
- The loop runs the script on `KosConfig.activeCpu`. If unset, the loop surfaces a "no CPU" error and idles. CPU is global on the data source, no per-widget picker.
- **Sticky cache**: late subscribers get the most recent value immediately on the next microtask, no full-cycle wait.
- **Breaker**: three consecutive `KosScriptError`s (script-author faults: runtime exceptions, `[KOSERROR]`, KOSUndefinedIdentifierException) trip a per-topic breaker. Transport / proxy / timeout errors don't count. Cleared via `kos.compute.<id>.reEnable`.
- **PerfBudget**: the fanout is covered by `KosDataSource.compute samples emitted/sec` (500/sec). New scripts inherit it, no per-script budget needed.

### What NOT to do

- Don't call `KosDataSource.executeScript` directly from a feed widget, you'll get a duplicate dispatch and break the "one loop per script" invariant.
- Don't mock `useDataValue` or `useKosScriptStatus` in tests. Use a fake `kos` source that implements `subscribe / getTopicStatus / onTopicStatusChange` (see `KosProcessors/index.test.tsx` for the reusable pattern).
- Don't put per-call args in the script. The centralised registry assumes a no-args, on-interval contract; if you need args, you're in the RPC case and should use `executeScript` directly.

## CI/CD

- `.github/workflows/ci.yml`: runs on pushes to `main` and PRs targeting `main`. Three jobs run in parallel: `test` (lint + `pnpm test`), `e2e` (Playwright, matrixed chromium/firefox/webkit), and `visual` (the per-engine visual regression gate, matrixed the same way; see below).
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
(C# half; its debt list is EMPTY as of 2026-08-20, keep it that way). Full rules
and the reasoning: `docs/uplink-isolation.md`.

---

## Spending funds: always show the balance

Any widget that exposes an action which spends career funds (launch a craft, upgrade a facility, accept an advance, unlock a tech) **must display the current funds balance somewhere visible in the same widget**. Subscribe to `career.funds` and surface it next to the spend control, a small "Funds: 289,848f" readout in the header is enough. The operator should never be forced to look at another widget to find out whether they can afford the thing they're about to confirm.

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
