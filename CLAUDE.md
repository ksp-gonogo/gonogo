# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Vision

**gonogo** is a mission control SPA for Kerbal Space Program. It operates in two modes within the same app:

- **Main screen** (`/`) — connects to KSP data sources, hosts a live telemetry dashboard, and distributes data to connected station screens via PeerJS.
- **Station screen** (`/station`) — a peer-connected dashboard whose layout and role are stored in `localStorage`. Stations can optionally pull a saved config from the main screen. There are no per-station routes; each device at `/station` is its own independent station.

The defining feature is a **context-aware, extensible dashboard component system**: components self-register into a global registry, and the dashboard orchestrator renders whatever is registered. External packages (not in this repo) can add components and themes using the same API as the built-in library.

---

## Monorepo Structure

```
packages/
  core/       — Plugin registry, shared TS types, React contexts, GO/NO-GO system
  components/ — Built-in dashboard component library (uses core registry)
  serial/     — Serial input platform: device types, transports, render styles,
                InputDispatcher, VirtualDevice widget + UI (see Serial section below)
  ui/         — Reusable UI primitives (buttons, inputs, tabs, modal, icons, etc.)
  app/        — Vite + React SPA (main screen + station mode)
  telnet-proxy/ — Fastify server: spawns system telnet via node-pty, bridges to WebSocket
  relay/      — Fastify server bundling the OCISLY camera fan-out, the
                /ice-config endpoint, and a coturn TURN/STUN child process
                with a per-restart-rotated shared secret
```

**Tooling:** pnpm workspaces + Turborepo. Package names use the `@gonogo/` scope.

---

## Workflow

Solo-developer repo. Work directly on `main` — no feature branches, no pull requests. Commit and push straight to `main`.

If a Claude Code session opens with an auto-assigned working branch (e.g. `claude/<task-slug>`), treat this note as the user's standing override: check out `main` and proceed there.

## Commits

Do not add a `Co-Authored-By: Claude …` (or any other Claude/Anthropic attribution) trailer to commit messages in this repo. Write the commit message as if a human authored it.

## Commands

```bash
pnpm install          # install all workspace dependencies
pnpm dev              # run app (Vite) and proxy server in parallel
pnpm build            # build all packages via Turborepo
pnpm test             # run tests across all packages
pnpm lint             # lint all packages
pnpm --filter @gonogo/app dev       # run only the SPA
pnpm --filter @gonogo/telnet-proxy dev     # run only the telnet proxy server
pnpm --filter @gonogo/core test     # test a single package
```

**Node version:** run `nvm use` before `pnpm`/`node` if your shell isn't already on the repo's pinned version (`.nvmrc` → 24). Do **not** `source ~/.nvm/nvm.sh` — `nvm` is already on the PATH in this environment, so just invoke it directly.

---

## Architecture

### Data Flow

```
KSP (Telemachus Reborn HTTP/WS) ──→ Main screen (direct, React Query)
KSP (kOS via telnet)            ──→ @gonogo/telnet-proxy (Fastify + node-pty + system telnet)
                                         └──→ Main screen (WebSocket)
Main screen ←──→ Station screens (PeerJS data channels, via peerjs.com broker)
```

Telemachus Reborn is a standard HTTP/WebSocket API — the browser talks to it directly. The proxy server is **only required for kOS integration**; without it, all other features still work. The app must display proxy connection status prominently in the UI.

### `@gonogo/core`

The foundation for everything extensible:

- **Plugin registry** — `registerComponent(def)`, `registerTheme(def)`, and `registerDataSource(def)` are the three extension points. Calling these at module load time is all that's needed to extend the app.
- **Shared TypeScript types** — `ComponentDefinition`, `ThemeDefinition`, `DataSourceDefinition`, `StationConfig`, `DataRequirement`, `Behavior`, etc.
- **React contexts** — `DashboardContext` (current layout, orchestrator state), `PeerContext` (PeerJS connection state), `StationContext` (station identity/role from localStorage).
- **GO/NO-GO system** — aggregates GO/NO-GO state across all active stations. A component can declare `behaviors: ['gonogo-participant']` in its definition to contribute to the global state.
- **Data source interface (repository pattern)** — all data sources implement a common `DataSource` interface:
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
- **`useDataValue(dataSourceId, key)`** and **`useExecuteAction(dataSourceId)`** are the universal hooks that all components use to read data and fire actions. Components never call `getDataSource()` or any `DataSource` method directly. These hooks are the **PeerJS boundary**: on the main screen they call the DataSource directly; on a station screen (future) they will route through PeerJS instead. The component code doesn't change — only the hook routing does.

### `@gonogo/components`

The built-in component library. Each component file calls `registerComponent()` on import — there is no central index that manually lists them; the orchestrator just needs to import the package and registration happens automatically.

Components declare their `dataRequirements` (e.g. `['vessel.altitude']`) so the orchestrator knows what data to subscribe to. The data layer resolves requirements against registered data sources.

Components are styled with **styled-components**. Component names and styled sub-components follow BEM-inspired naming for readability (e.g. `AltitudeGauge`, `AltitudeGauge__Label`, `AltitudeGauge__Value`).

### `@gonogo/app`

The Vite SPA. Key responsibilities:

- **Dashboard orchestrator** — a layout engine built on [React Grid Layout](https://github.com/react-grid-layout/react-grid-layout) (`ResponsiveGridLayout`) that reads the current layout config and renders registered components by ID. It does not hardcode any component — it only knows about the registry. Positions are stored in **grid units** (column/row spans), not pixels, so layouts are resolution-independent. The serialised layout format stores a per-breakpoint map (`lg`, `md`, `sm`, etc.) so the grid reflows across screen sizes. Per-instance component config is stored alongside the layout.
- **Telemachus Reborn client** — direct HTTP/WS integration using React Query. Components that need telemetry data declare requirements; the orchestrator resolves and subscribes to the right endpoint.
- **kOS WebSocket client** — connects to `@gonogo/telnet-proxy`. The proxy status is shown persistently in the main screen UI. If the proxy is not reachable, affected components degrade gracefully.
- **PeerJS integration** — the main screen acts as the peer host. Stations connect as peers. The main screen distributes a serialised snapshot of data to all peers; stations can also send state back (e.g. GO/NO-GO votes).
- **Station config** — localStorage-first. Stations can request a config from the main screen over PeerJS; the main screen can push saved configs to connecting stations.

### `@gonogo/telnet-proxy`

A minimal Fastify server. Its only job is bridging kOS telnet sessions to a WebSocket that the browser can consume — by spawning `telnet host port` via `node-pty` so all IAC negotiation is handled by the system telnet binary. It should be runnable with a single command and have clear setup instructions in its own README. The main screen should show an unambiguous status indicator for this connection.

---

## Extension Pattern

Both components and themes follow the same self-registration pattern:

```ts
// An external npm package can do this:
import { registerComponent } from '@gonogo/core';

registerComponent({
  id: 'my-custom-gauge',
  name: 'My Custom Gauge',
  category: 'telemetry',
  component: MyCustomGauge,
  dataRequirements: ['vessel.altitude'],
  behaviors: [],           // e.g. ['gonogo-participant'] to join GO/NO-GO
  defaultConfig: {},
});
```

```ts
import { registerTheme } from '@gonogo/core';

registerTheme({
  id: 'retro-nasa',
  name: 'Retro NASA',
  theme: { colors: { ... }, fonts: { ... } }, // passed to styled-components ThemeProvider
});
```

The built-in `@gonogo/components` package models this pattern exactly — it is not treated as special by the orchestrator.

---

## Testing Philosophy

Prefer tests that mock as little of the system as possible. Use [Mock Service Worker (MSW)](https://mswjs.io/) to intercept at the network boundary rather than mocking modules.

- **Integration tests** (in `@gonogo/app`) use MSW WebSocket/HTTP handlers to simulate KSP APIs. The real data source, real hook, and real component all run — only the network is intercepted. This is the preferred form for tests involving connection status or data flow.
- **Unit tests** (in `@gonogo/core`, `@gonogo/components`) use the real registry with simple disconnected fixture data sources. No `vi.mock()` of internal modules. MSW is only needed when a test actually triggers a network call.
- Avoid mocking `useDataSources` or other core hooks in component tests — render the real component with real registry state instead.
- **`act()` warnings are always our bug** — never dismiss them. Two common fixes:
  1. `connect()` must resolve from *inside* the `open` event handler (after `setStatus`), not before the event fires.
  2. In `afterEach`, call `cleanup()` before `source.disconnect()` — disconnecting while a component is still mounted triggers state updates outside `act`.
  Use `waitFor` rather than `act` for assertions on async external events (WebSocket, PeerJS).

---

## Telemachus Reborn API

Connects via WebSocket to `ws://host:8085/datalink`. Subscribe by sending `{ "run": ["v.sasValue", ...], "rate": 250 }`. Server streams JSON updates: `{ "v.sasValue": true, ... }`. Execute actions via HTTP GET: `GET http://host:8085/telemachus/datalink?a=<actionKey>` with `mode: 'no-cors'` (state change arrives back over the WS). Toggle keys use `f.` prefix; value keys use `v.` prefix (e.g. `f.ag1` toggles, `v.ag1Value` reads).

## Centralised kOS scripts

The kOS data source runs registered kerboscripts on the user's active CPU and fans the parsed payloads out to subscribers as standard `kos.compute.<id>.<field>` data keys. One loop per script, regardless of how many widgets subscribe. This is the **default path for any new kOS-driven widget** — `useKosScriptPayload` / `useKosWidget` are reserved for the niche RPC case (per-call args, request/response).

### When to use this vs. raw `executeScript`

- **Centralised feed** (this section) — passive listing / telemetry / state snapshot, same payload for every subscriber. Examples: ShipMap parts, KosProcessors listing, TargetPicker vessel list. The widget calls `useDataValue` and is done.
- **Raw `executeScript`** — RPC-shaped one-shots that take per-call args. Examples: KosFiles (op + path → contents), TargetPicker's set-target click. The widget calls `getDataSource("kos").executeScript(cpu, scriptPath, args, managed)` directly. No registry entry, no fanout.

### Adding a new feed-style widget

Three pieces — the kerboscript, the registration, and the widget consumption.

**1. The kerboscript** — emit a topic-tagged `[KOSDATA]` block:

```
PRINT "[KOSDATA:my-feed]parts=" + json + "[/KOSDATA]".
```

The topic id (`my-feed`) must match the `id` you register below. JSON values are passed as JSON-encoded strings; scalars (number / boolean / string) can be emitted directly.

**2. Self-register at module load**, alongside `registerComponent`. Same lifecycle pattern. Put this at the bottom of your `<widget>Script.ts`:

```ts
import { registerKosScript } from "@gonogo/core";

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
import { useDataValue, useExecuteAction } from "@gonogo/core";
import { useKosScriptStatus } from "@gonogo/data";

const parts = useDataValue<MyPart[]>("kos", "kos.compute.my-feed.parts");
const status = useKosScriptStatus("my-feed");
const executeKos = useExecuteAction("kos");

const dispatchNow = () => void executeKos("kos.compute.my-feed.dispatchNow");
const reEnable = () => void executeKos("kos.compute.my-feed.reEnable");
```

`useDataValue` carries the value; `useKosScriptStatus` carries `running / lastGoodAt / scriptError / parseError / paused` — bits that don't fit the value channel. The standard `KosScriptFrame` chrome accepts all those props directly.

Add the data key to the widget's `dataRequirements` so the orchestrator's debug surfaces know about it.

### Lifecycle, breaker, sticky cache

- **0 → 1 subscriber** on a topic starts the loop. **1 → 0** schedules teardown after a 5s grace so React StrictMode remounts don't churn the dispatcher.
- The loop runs the script on `KosConfig.activeCpu`. If unset, the loop surfaces a "no CPU" error and idles. CPU is global on the data source — no per-widget picker.
- **Sticky cache**: late subscribers get the most recent value immediately on the next microtask, no full-cycle wait.
- **Breaker**: three consecutive `KosScriptError`s (script-author faults — runtime exceptions, `[KOSERROR]`, KOSUndefinedIdentifierException) trip a per-topic breaker. Transport / proxy / timeout errors don't count. Cleared via `kos.compute.<id>.reEnable`.
- **PerfBudget**: the fanout is covered by `KosDataSource.compute samples emitted/sec` (500/sec). New scripts inherit it — no per-script budget needed.

### What NOT to do

- Don't call `KosDataSource.executeScript` directly from a feed widget — you'll get a duplicate dispatch and break the "one loop per script" invariant.
- Don't mock `useDataValue` or `useKosScriptStatus` in tests. Use a fake `kos` source that implements `subscribe / getTopicStatus / onTopicStatusChange` (see `KosProcessors/index.test.tsx` for the reusable pattern).
- Don't put per-call args in the script. The centralised registry assumes a no-args, on-interval contract; if you need args, you're in the RPC case and should use `executeScript` directly.

## CI/CD

- `.github/workflows/ci.yml` — runs `pnpm test` on all PRs and pushes to any branch.
- `.github/workflows/deploy.yml` — triggers on `workflow_run` (CI passes on `main` only), builds with `pnpm turbo build --filter=@gonogo/app...`, deploys to GitHub Pages at `https://jonpepler.github.io/gonogo/`. Vite base is set to `/gonogo/`. GitHub Pages source must be set to **GitHub Actions** in repo settings.

---

## Logs (Axiom)

Production logs from the deployed app stream to Axiom. The project-scope MCP server (`.mcp.json`) gives Claude Code direct query access — first call in a new session triggers OAuth in the browser.

- **Dataset:** `gonogo`
- **Query language:** APL (Kusto-flavoured, run via the `axiom` MCP)
- **Retention:** 30 days (free tier)
- **Source:** every entry the in-app `ConsoleLogger` emits is fanned out to Axiom in addition to the browser console + ring buffer. See `packages/core/src/logger/`.
- **Build wiring:** `VITE_AXIOM_TOKEN` is set as a GitHub Actions secret and passed through in `deploy.yml`. Without the secret, the transport silently doesn't install — local dev never hits Axiom.

### Entry shape

Top-level fields you can filter on:

- `level` — `debug` | `info` | `warn` | `error`
- `message` — human string (already prefixed with `[tag]` if tagged)
- `tag` — optional verbose-tracing tag (`peer`, `peer:ice`, `peer:kos`, …)
- `device.role` — `host` | `station` | `unknown`
- `device.id` — host short id (e.g. `XK3F`) or station UUID (`stationKey`)
- `device.peerId` — broker peer id (host: same as `id`; station: `station-<key>-<sessionToken>`, fresh each page-load)
- `device.hostPeerId` — for stations: which host they're connected to
- `sessionId` — fresh UUID per page load (groups everything from one tab)
- `context` — free-form bag set at the call site
- `error.{name,message,stack}` — when applicable

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
3. If it's a peer/connection bug, also pull the *other* side's log — the host's view of the same `peerId`, or the station's view of the same `hostPeerId`.
4. Verbose tracing tags (`peer:ice`, `peer:kos`) are off in console output by default but always shipped to Axiom — check those first when chasing a peer/connection issue.

### When NOT to use

- For a live debugging session against your own browser, the in-page `localStorage` ring buffer + `logger.exportLogs()` is faster (no round-trip).
- For long-tail post-mortems and "what did the other user see", Axiom.

---

## UI Components

Basic, reusable UI elements (toggles, inputs, buttons, tags, etc.) belong in `@gonogo/ui`, not co-located with the feature that first needs them. If a primitive doesn't exist in `@gonogo/ui` yet and you need it, add it there rather than creating a local one-off. Duplication in files you're not actively editing is easy to miss — a consistent home in `@gonogo/ui` prevents that.

---

## Accessibility

Baseline expectations for every new or modified component. Targets WCAG 2.1 AA; see the [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/) for the canonical widget patterns.

- Interactive elements are real `<button>` / `<a>` / `<input>` — never `<div onClick>`.
- Every form input has an associated `<label htmlFor>` or is wrapped in a `<label>`.
- Icon-only buttons get an `aria-label`; decorative SVGs get `aria-hidden="true"`.
- Components are fully operable by keyboard. For custom widgets, follow the APG pattern (tablist arrow nav, combobox + listbox, etc.).
- Keyboard focus is visible: use `:focus-visible { outline: 2px solid #00ff88; outline-offset: 2px; }`. Never strip `outline` without a replacement.
- Wrap mission-state changes (e.g. GO/NO-GO transitions) in `role="status" aria-live="polite"`. Reserve `role="alert"` / `aria-live="assertive"` for events that must interrupt (ABORT). Don't live-region streaming telemetry — it floods screen readers.
- Respect `prefers-reduced-motion` on any new animation — the global reset in `packages/app/src/styles/global.css` damps transitions, but indefinite CSS animations (e.g. pulses) need an explicit `@media (prefers-reduced-motion: no-preference)` guard.
- Colour contrast: 4.5:1 for normal text, 3:1 for large text and non-text UI (focus rings, borders).
- Component tests should include a `jest-axe` smoke assertion (`await axe(container)` → `toHaveNoViolations()`).

---

## Performance Budgets

`@gonogo/core` exposes a `PerfBudget` class that tracks rolling-window event rates and warns + fails CI when a soft cap is breached. The dashboard widget `Perf Budgets` shows every registered budget live; a global test-gate (`PerfBudget.installTestGate()` wired into each package's `setupFiles`) fails any test that pushes a budget over its threshold. See `local_docs/performance_review.md` for the design and the existing budgets.

**Required: any new data source MUST register a sample-rate or dispatch-rate `PerfBudget`.** Data sources are the highest-frequency surface in the app — a misconfigured WebSocket, a runaway poll, or a duplicated subscription will silently degrade the whole dashboard. The budget catches all three.

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

`@gonogo/serial` is the per-screen serial input layer. It lets a user plug a physical (or virtual) device into a screen, declare its button/analog inputs, and map those inputs onto dashboard-component **actions**.

- **Device types** are user-defined at runtime via the **Serial Devices** menu (joystick FAB, bottom-right of any screen). A type names its inputs, selects a parser (`char-position` is the only one for now), and optionally picks a render style that pipes values back out to the hardware.
- **Device instances** are per-screen (localStorage key `gonogo.serial.devices.<screenKey>`) and come in two transports: `web-serial` (real USB via `navigator.serial`) and `virtual` (in-memory, driven from the **Virtual Device** widget or from tests via `VirtualTransport.inject`). A default `Virtual Controller` type + instance is seeded on first run.
- **Component actions** — every component declares its actions in `registerComponent({ actions: [...] })` and handles them with `useActionInput<typeof actions>({ ... })` inside the component body. Consider actions a core part of any new component, alongside `dataRequirements`.
- **Input mapping** — the dashboard config modal shows an **Inputs** tab whenever a component has actions. Saved mappings live on `DashboardItem.inputMappings` and are consumed by `InputDispatcher`, which routes `{ deviceId, inputId }` events to `dispatchAction(instanceId, actionId, payload)`. Handler return values feed the device's render style and are written back via `transport.write()` on a debounce.
- **Render styles** are code-registered via `registerSerialRenderStyle()`; the built-in `text-buffer-168` (21×8 ASCII) self-registers when `SerialDeviceService` loads. Add new styles alongside it under `packages/serial/src/renderStyles/`.
- **Testing serial flows** — prefer `VirtualTransport` (no Web Serial needed) for most integration tests, and the `MockWebSerial` helper when you specifically need to exercise the `WebSerialTransport` read/write path. Both live in `@gonogo/serial`.

Serial events stay on the screen where the device is plugged in — they are **not** broadcast over PeerJS. A station that wants physical inputs has its own local devices and mappings.

---

## Key Design Constraints

- **Main screen is the sole KSP data consumer.** Stations never talk to KSP directly; they receive data exclusively from the main screen over PeerJS.
- **Telnet proxy is optional infrastructure, not a core dependency.** The app must function (minus kOS features) without it. Never make the proxy a hard startup requirement.
- **PeerJS broker is configurable.** Default to `0.peerjs.com` but expose a config option (environment variable or settings UI) to point at a self-hosted broker.
- **Themes are runtime-switchable.** The ThemeProvider must be driven by the active theme from the registry, not hardcoded at build time.
- **Station identity is localStorage-first.** Never assume a station has a server-side identity. Server-saved configs are a convenience layer on top of a fully local-first station.
