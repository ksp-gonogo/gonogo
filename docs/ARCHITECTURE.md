# Architecture

gonogo is a pnpm + Turborepo monorepo. Everything is built around one idea: a context-aware, extensible widget system. Widgets self-register into a global registry, and the dashboard orchestrator renders whatever is registered. External packages extend the app through the same API as the built-in library; nothing is hardcoded.

## Package map

```
packages/
  core/        — Plugin registry, shared TS types, React contexts, GO/NO-GO system
  components/  — Built-in dashboard widget library (uses the core registry)
  data/        — Flight history + data hooks (useDataSeries, useFlight, …)
  serial/      — Per-screen serial input platform: device types, transports,
                 render styles, InputDispatcher, VirtualDevice widget + UI
  ui/          — Reusable UI primitives (buttons, inputs, tabs, modal, icons)
  kerbcast/     — Consumer of the kerbcast camera-streaming sidecar; registers
                 a `kerbcast` data source + the Camera Feed widget
  app/         — Vite + React SPA (main screen + station mode)
  telnet-proxy/— Fastify server: spawns system telnet via node-pty, bridges
                 to a WebSocket the browser can consume (kOS only)
  relay/       — Fastify server hosting /ice-config (TURN credentials) and a
                 coturn TURN/STUN child process with a per-restart-rotated
                 shared secret, for the camera channel and future
                 cross-internet stations. Also a diagnostics-only /host
                 registry; it is not in the station-discovery path
```

Package names use the `@gonogo/` scope.

## Data flow

```
KSP (Telemachus HTTP/WebSocket) ──► Main screen (direct, React Query)
KSP (kOS via telnet)            ──► @gonogo/telnet-proxy (Fastify + node-pty
                                       + system telnet) ──► Main screen (WebSocket)
Main screen ◄──► Station screens (PeerJS data channels, via a public broker)
```

Telemachus is a standard HTTP/WebSocket API, so the browser talks to it directly. The telnet proxy is **only** required for kOS; without it every other feature still works. The app shows proxy connection status prominently.

Two design constraints fall out of this:

- **The main screen is the sole KSP data consumer.** Stations never talk to KSP directly; they receive data exclusively from the main screen over PeerJS.
- **The telnet proxy is optional infrastructure, not a core dependency.** The app must function (minus kOS features) without it.

## `@gonogo/core`

The foundation for everything extensible.

- **Plugin registry**: `registerComponent(def)`, `registerTheme(def)`, and `registerDataSource(def)` are the three extension points. Calling these at module load time is all that's needed to extend the app.
- **Shared TypeScript types**: `ComponentDefinition`, `ThemeDefinition`, `DataSourceDefinition`, `StationConfig`, `DataRequirement`, `Behavior`, …
- **React contexts**: `DashboardContext` (current layout, orchestrator state), `PeerContext` (PeerJS connection state), `StationContext` (station identity/role from localStorage).
- **GO/NO-GO system** aggregates GO/NO-GO state across all active stations. A widget declares `behaviors: ['gonogo-participant']` to contribute to the global state.

### The data-source interface (repository pattern)

All data sources implement a common interface, so widgets never care where their data comes from:

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

Widgets read data and fire actions through two universal hooks:

```ts
const altitude = useDataValue('telemachus', 'vessel.altitude');
const execute  = useExecuteAction('telemachus');
```

These hooks are the **PeerJS boundary**. On the main screen they call the DataSource directly; on a station screen they route through PeerJS instead. The widget code doesn't change; only the hook routing does. Widgets never call a `DataSource` method directly.

## `@gonogo/components`

The built-in widget library. Each widget file calls `registerComponent()` on import; there is no central index that lists them. The orchestrator just imports the package and registration happens as a side effect.

Widgets declare their `dataRequirements` (e.g. `['vessel.altitude']`) so the orchestrator knows what to subscribe to, and their `actions` so the serial-input layer and the config modal know what they can do. Styling is [styled-components](https://styled-components.com/); widget and sub-component names follow BEM-inspired naming (`AltitudeGauge`, `AltitudeGauge__Value`).

## `@gonogo/app`

The Vite SPA. Key responsibilities:

- **Dashboard orchestrator**: a layout engine on [React Grid Layout](https://github.com/react-grid-layout/react-grid-layout). It reads the layout config and renders registered widgets by id; it hardcodes no widget. Positions are stored in **grid units** (column/row spans), not pixels, so layouts are resolution-independent. The serialised format stores a per-breakpoint map (`lg`, `md`, `sm`, …) so the grid reflows across screen sizes. Per-instance widget config is stored alongside the layout.
- **Telemachus client**: direct HTTP/WS integration using React Query.
- **kOS WebSocket client** connects to `@gonogo/telnet-proxy` and degrades gracefully if the proxy is unreachable.
- **PeerJS integration**: the main screen is the peer host; stations connect as peers. The main screen distributes a serialised data snapshot to all peers; stations can send state back (e.g. GO/NO-GO votes).
- **Station config** is localStorage-first. Stations can request a config from the main screen over PeerJS, and the main screen can push saved configs to connecting stations.

## Extension pattern

Widgets and themes follow the same self-registration pattern. An external npm package does exactly this:

```ts
import { registerComponent } from '@gonogo/core';

registerComponent({
  id: 'my-custom-gauge',
  name: 'My Custom Gauge',
  category: 'telemetry',
  component: MyCustomGauge,
  dataRequirements: ['vessel.altitude'],
  actions: [],            // declare what the widget can do (serial input maps onto these)
  behaviors: [],          // e.g. ['gonogo-participant'] to join GO/NO-GO
  defaultConfig: {},
});
```

```ts
import { registerTheme } from '@gonogo/core';

registerTheme({
  id: 'retro-nasa',
  name: 'Retro NASA',
  theme: { colors: { /* … */ }, fonts: { /* … */ } }, // passed to the styled-components ThemeProvider
});
```

The built-in `@gonogo/components` package models this pattern exactly; the orchestrator does not treat it as special. Themes are runtime-switchable: the `ThemeProvider` is driven by the active theme from the registry, never hardcoded at build time.

## Serial input platform

`@gonogo/serial` is a per-screen input layer that maps physical (or virtual) USB controllers onto widget actions. Device types are user-defined at runtime; device instances are per-screen (localStorage) and come in `web-serial` (real USB) and `virtual` (in-memory) transports. Serial events stay on the screen where the device is plugged in; they are **not** broadcast over PeerJS. See [`packages/serial/README.md`](../packages/serial/README.md) for the full walkthrough.

## Performance budgets

`@gonogo/core` exposes a `PerfBudget` class that tracks rolling-window event rates and fails CI when a soft cap is breached. The `Perf Budgets` dashboard widget shows every registered budget live. Any new data source must register a sample-rate or dispatch-rate budget. Data sources are the highest-frequency surface in the app, and the budget catches a runaway poll, a misconfigured socket, or a duplicated subscription.
