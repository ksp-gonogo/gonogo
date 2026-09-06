# Architecture

gonogo is a pnpm + Turborepo monorepo. Everything is built around one idea: a context-aware, extensible widget system. Widgets self-register into a global registry, and the dashboard orchestrator renders whatever is registered. External packages extend the app through the same API as the built-in library; nothing is hardcoded.

## Package map

```
packages/
  core/          : Plugin registry, shared TS types, React contexts, GO/NO-GO system
  components/    : Built-in dashboard widget library (uses the core registry)
  data/          : Flight history + data hooks (useDataSeries, useFlight, ...)
  serial/        : Per-screen serial input platform: device types, transports,
                    render styles, InputDispatcher, VirtualDevice widget + UI
  ui/            : App-side UI: dashboard chrome, the settings modal's furniture,
                    PeerJS banners, plus one-line re-exports of ui-kit primitives
  ui-kit/        : The PUBLISHED design system: layout primitives, readouts, form
                    controls, the Panel family, the unit renderer, /testing and
                    the render harness. The only UI package an Uplink may import
  theme/         : Design tokens (tokens.css), consumed by ui-kit
  logger/        : ConsoleLogger + the Axiom transport
  sitrep-client/ : The app-side telemetry spine: WebSocketTransport,
                    TelemetryClient, TimelineStore, ViewClock, command delay
  test-utils/    : Shared test helpers for the packages above
  app/           : Vite + React SPA (main screen + station mode)
  relay/         : Fastify server hosting /ice-config (TURN credentials) and a
                    coturn TURN/STUN child process with a per-restart-rotated
                    shared secret, for the camera channel and future
                    cross-internet stations. Also a diagnostics-only /host
                    registry; it is not in the station-discovery path

mod/
  Sitrep.Contract/ : The wire vocabulary. Payload types tagged [SitrepTopic],
                      command args, the manifest/channel-declaration types.
                      Codegen's input, via the .Codegen twin beside it
  Sitrep.Host/     : ChannelEngine and the view providers: what actually puts
                      a value on the wire each tick
  Sitrep.Core/     : The capability kernel, serialization, uplink discovery
  sitrep-sdk/      : The PUBLISHED authoring surface: hooks, every registerX, the
                      generated contract types, the unit model, the gonogo-uplink CLI
  codegen.sh       : C# -> TS. Run it through `pnpm codegen`, never directly
  Gonogo*Uplink*/  : The bundled Uplinks, each four C# projects plus a client
```

Package names use the `@ksp-gonogo/` scope. Two of them are published to npm,
`@ksp-gonogo/sitrep-sdk` and `@ksp-gonogo/ui-kit`, and those two are the entire
surface a third-party Uplink may build against; everything else is
`private: true`. See [uplink-isolation.md](./uplink-isolation.md).

## Data flow

```
KSP + Gonogo mod (Sitrep telemetry, WS) ──► Main screen (direct, ws://host:8090)
KSP (kOS)                               ──► Gonogo mod kos.run / kos.processors
                                              Uplink (same WS stream) ──► Main screen
Main screen ◄──► Station screens (PeerJS data channels, via a public broker)
```

The Gonogo mod (engineering codename "Sitrep") is the app's telemetry source: the browser opens a WebSocket straight to it (`SitrepTelemetryProvider` in `@ksp-gonogo/app`, backed by `@ksp-gonogo/sitrep-client`'s `WebSocketTransport`), no HTTP polling. It replaced an HTTP-polled data source, which is deleted. kOS integration rides this same stream now, script dispatch over the `kos.run` command and CPU discovery over the `kos.processors` channel, so there is no separate telnet proxy anymore.

The main-screen-is-sole-consumer constraint falls out of this:

- **The main screen is the sole KSP data consumer.** Stations never talk to KSP directly; they receive data exclusively from the main screen over PeerJS.

### A station reads the same Topics, and you wire nothing for it

A station mounts the identical `SitrepTelemetryProvider` the main screen does, over a `PeerTransport` instead of a `WebSocketTransport` (`packages/app/src/telemetry/PeerTransport.ts`, mounted by `StationScreen.tsx`). It therefore gets the same `TelemetryClient`/`TimelineStore`/`ViewClock` pipeline, and `useTelemetry('vessel.orbit')` in a widget is the same call with the same return type on both screens.

Delivery is **demand-driven, not snapshot-driven**. `PeerTransport.subscribe`/`unsubscribe` go over the PeerJS wire; host-side, `SitrepPeerRelay` holds one `client.subscribe` keep-alive per topic that any connected station says it is reading, and relays every `stream-data`/`event` frame it receives verbatim. Nothing maintains a list of topics stations are allowed to have. So **a new Topic reaches a station the moment a station widget reads it**, with no serialisation, allowlist or fan-out code to add.

The one thing a station cannot discover for itself is which Uplink bundles to load, so the relay holds `system.uplinks` on its behalf as a bootstrap floor. One arm of `Reading` is also decided differently on a station: `unowned` is never concluded there, because a station's subscribe only reaches the mod when the host's own refcount makes a 0 to 1 transition, so silence on a topic the host already holds proves nothing.

The older `data`-typed PeerJS traffic (GO/NO-GO votes, station config, flight-history RPCs, `DataSource.execute`) still rides its own snapshot-and-message path beside this one. It is not how a Topic travels.

## `@ksp-gonogo/core`

The foundation for everything extensible.

- **Plugin registry**: `registerComponent(def)`, `registerTheme(def)`, and `registerDataSource(def)` are the three extension points. Calling these at module load time is all that's needed to extend the app. The registry itself lives in `@ksp-gonogo/sitrep-sdk` and core re-exports it, so all three reach one `globalThis`-keyed set of Maps whichever package you import them from. Which of the three you actually want for a new data path is answered below, and for most work it is none of them: it is a Topic
- **Shared TypeScript types**: `ComponentDefinition`, `ThemeDefinition`, `ComponentBehavior`, `DataSource`, `DataRequirement`, ...
- **GO/NO-GO system** aggregates the human GO/NO-GO readiness state across all active stations. It is a human readiness ceremony (operators voting) that triggers a stage transition and nothing else, so no widget feeds into it.

### The data-source interface (repository pattern)

`DataSource` is a common interface for a thing the app can **connect to, configure, and show a status pill for**:

```ts
interface DataSource {
  id: string;
  name: string;
  connect(): Promise<void>;
  disconnect(): void;
  status: DataSourceStatus; // 'connected' | 'disconnected' | 'reconnecting' | 'error'
  schema(): DataKey[];      // DataKey = { key: string; description?: string }
  subscribe(key: string, cb: (value: unknown) => void): () => void;
  onStatusChange(cb: (status: DataSourceStatus) => void): () => void;
  execute(action: string): Promise<void>;
  configSchema(): ConfigField[];
  configure(config: Record<string, unknown>): void;
  getConfig(): Record<string, unknown>;
}
```

**Read this before you reach for it: a `DataSource` is not how telemetry reaches a widget, and has not been for some time.** The hook that read one, the two-argument `useTelemetry(dataSourceId, flatKey)`, has **zero production call sites** anywhere in this repo. It is a compile error through `@ksp-gonogo/sitrep-sdk/spine`; it is declared only on the SDK's published root barrel; and it is torn out with the rest of the shim at M4. Do not write new code against it. It also does not return what the one-argument form returns: the legacy overload answers a bare `T | undefined`, the canonical Topic form answers a `Reading`. One name, two categorically different shapes, which is a large part of why the legacy half is going.

What `registerDataSource` still buys you, and what every live registration uses it for, is three things:

- a row in **Settings → Data Sources** with a connect/disconnect pill driven by `status`/`onStatusChange`, and a config form generated from `configSchema()`
- a service-locator handle: `getDataSource('missionHistory')` is how the flight-history surface reaches its store
- `execute(action)` reachable from a station over PeerJS

The registrations that exist are `sitrep` (a config-form front for the stream; it carries no topics of its own), `missionHistory`, and the app's own peer-broadcast wrappers. kOS deliberately does **not** register one: it is an RPC client with no subscribable keys, so it registers as `registerUplinkHandle("kos", kosSource)` and never appears in the panel. Serial devices are their own per-screen layer and never touch this interface at all.

Registration is a module-load side effect, and something has to import the module for it to fire; in the app that is `packages/app/src/dataSources/index.ts`, whose only job is those imports. Registration does **not** call `connect()`; the settings row or a seed hook does.

```ts
import { registerDataSource } from '@ksp-gonogo/core'; // or '@ksp-gonogo/sitrep-sdk' from an Uplink

registerDataSource(myFeed); // an object satisfying DataSource; see PerfBudget below, which is required
```

`schema()` entries are what the config UI lists as available keys; with the legacy read hook gone they no longer make a key readable, and an empty array is honest for a source that carries no keys of its own, which is exactly what `sitrep` returns.

### Sitrep telemetry: Domain/Topic/Value

The Sitrep stream (the Gonogo mod's WebSocket feed) doesn't go through the `DataSource` interface, it has its own Uplink model, layered on top of `@ksp-gonogo/sitrep-client`. The mod's contract is organised into **Domains** (e.g. `vessel`, `career`, `spaceCenter`), each exposing named **Topics** (e.g. `vessel.orbit`, `career.status`); every Topic carries a typed **Value** payload generated from the C# contract (`@ksp-gonogo/sitrep-sdk`). `SitrepTelemetryProvider` (in `@ksp-gonogo/app`) owns the one `WebSocketTransport` to the mod and feeds a `TelemetryClient`/`TimelineStore` pair down through React context.

Widgets read and command Topics with `useTelemetry`/`useCommand`. There is no `useDataValue`: the name is retired and nothing exports it. Its write twin `useExecuteAction` is gone too, so every command goes through `useCommand`.

Where the two hooks come from depends on which side of the isolation boundary you are on:

```ts
// Inside this repo (packages/components, packages/app):
import { registerComponent, defineTopicManifest, useTelemetry } from '@ksp-gonogo/core';
import { observedAt, type Reading, useCommand, useStream } from '@ksp-gonogo/sitrep-client';
import { observedValue } from '@ksp-gonogo/sitrep-sdk';
import { usePanelDelay } from '@ksp-gonogo/ui-kit';

// From an Uplink, which may import only the two published packages:
import { observedValue, registerComponent, useCommand, useTelemetry } from '@ksp-gonogo/sitrep-sdk';
import { usePanelDelay } from '@ksp-gonogo/ui-kit';
```

`defineTopicManifest` is `@ksp-gonogo/core` only and is deliberately not on the SDK, so an Uplink declares `channels` directly and calls the free `useTelemetry`. The SDK subpaths an Uplink may import are `/frames`, `/media` and `/testing`; `/spine` and `/registry` are first-party plumbing, not author surfaces.

#### Reading a Topic: `Reading` and its arms

`useTelemetry` answers a `Reading<T>`, never the payload. It is a union over **two independent discriminants**, `state` and `reckoning`.

`state` is how current the value is, and there are five:

- `pending`: nothing at or before this frame's view time yet. A cold topic, or a resync after a rewind. It may still arrive
- `unowned`: nothing will *ever* publish this. No installed Uplink declares it, so waiting is futile. Decided by the mod answering a subscribe with nothing, never inferred from silence, and never decided at all on a station
- `absent`: a confirmed tombstone. The producer says there is no value. Carries `atUt`, because a tombstone can itself go old: "no target set, confirmed 3 s ago"
- `observed`: the newest sample that could have reached us. Carries `value` and `atUt`
- `stale`: we have missed updates. Carries the last REAL observation as `value`, the `asOfUt` it was made at, and a `grade`

`reckoning` is whether a forward model is on offer, and it is a separate axis because a conic solved from the elements on the wire is modelled whether or not the last packet was late. It is `"none"` on most readings; when it is `"available"`, `reckoned` carries what the model says the quantity is at this frame's view time. Every member carries the field, `pending` and `absent` included (permanently `"none"`), so `reading.reckoning === 'available'` can be asked without first narrowing `state`.

Five states with a reckoning only reachable on the two that carry a value is **seven members** in the union.

`reckoned` is a *required* field of a member selected by a *required* discriminant, so `reading.reckoned` does not compile until `reading.reckoning === 'available'` has been written. Reaching a modelled figure costs a branch, exactly as reaching a value does. A topic the C# contract declares reckonable answers with `ReckonableReading` instead, whose `reckoned` is only the fields the declared model moves, not the whole payload.

```ts
const orbit = useTelemetry('vessel.orbit');

switch (orbit.state) {
  case 'pending':  return waiting();                  // may still arrive
  case 'unowned':  return nothingPublishesThis();     // it never will
  case 'absent':   return confirmedNoOrbit(orbit.atUt);
  case 'observed': return draw(orbit.value, undefined);
  case 'stale':    return draw(orbit.value, orbit.grade); // last real observation, captioned
}
```

Four accessors live on `@ksp-gonogo/sitrep-sdk` so this does not get written out by hand in every widget:

- `observedValue(reading)`: the value of an **observed** reading and `undefined` on every other arm, including `stale`. The narrowing for a fact that only means something if it is current: a verdict, a band, whether a control may be pressed
- `observedAt(reading)`: the `Value<'ut'>` an observation was made at (`atUt` or `asOfUt`), `undefined` for `pending`/`unowned`. An age is `viewUt.minus(observedAt(reading))`
- `hasAnswered(reading)`: whether the producer has spoken at all. The **presence gate**, and the reason to use it rather than `state !== 'pending'` is that a hand-rolled check reads `unowned` as an answer and shows an Uplink's UI on an install where the Uplink is not present
- `withoutReckoning(reading)`: a written choice to ignore a model. `stale` still has to be handled; what it removes is a branch for a case that cannot occur

**The trap, which the compiler cannot catch:** a `Reading` is an object, so it is always truthy and never nullish. Every gate written for the old bare-payload shape stays legal TypeScript and silently fails open.

```ts
const parts = useTelemetry('vessel.parts');
if (!parts) return EMPTY;          // never fires
if (parts === undefined) return null;  // never fires
(parts ?? []).filter(...)          // never takes the fallback
```

`packages/core/src/styleguide-reading-gates.test.ts` is a text scan that catches the common shapes of this and names its own blind spots; it is not type analysis and it cannot see a reading passed to a function or destructured.

#### Commanding a Topic

```ts
const stage = useCommand('vessel.control.stage');
usePanelDelay(stage);                        // required: see below

const onPress = () => {
  void stage.send().catch(() => { /* refusals and losses also land on `stage.refusals` / `stage.losses` */ });
};
const busy = stage.status.phase === 'in-flight';
```

`useCommand(commandId)` returns a handle: `send(args?, opts?): Promise<TReply>` plus `status` (itself a discriminated union on `phase`: `idle`, `in-flight`, `confirmed`, `failed`, `refused`, `lost`, `undelivered`, `found`), and the delay bookkeeping for its **own** dispatches: `inFlight`, `refusals` (the game said no), `losses` (no answer came), `undelivered` (never left this machine), `founds` (reported lost, then answered), and `gate` (what the mod says in advance about whether this command is currently blocked). `TArgs`/`TReply` come from the generated command map when the id is a known `CommandId`; a computed id falls back to an untyped handle. With no provider mounted the hook degrades: `status` stays idle and `send` is a no-op rather than a throw. Every non-success rejects with a `CommandError` carrying `code`, so a refusal is never swallowed.

**`usePanelDelay` is not decoration and not optional.** It publishes the handle into the nearest delay rail so `Panel.Delay` can draw the command's in-flight state, and in doing so it consumes a dev-only must-consume token on the handle. `send()` asserts that token and **throws in development if nothing consumed it**, so a delayed command cannot ship without its delay UX. It is a no-op outside a dashboard (no rail in the tree), which still counts as wired. `<CommandDelay handle={cmd}>` is the equivalent inline form. Both come from `@ksp-gonogo/ui-kit`.

#### Adding a Topic: the primary new data path

A Topic is declared in C#, published by the host, and typed into TypeScript by codegen. Four steps, all of them required.

1. **Declare the payload type** in `mod/Sitrep.Contract/` for a core topic, or in that Uplink's own `mod/<Uplink>.Contract/` slice, never in `Sitrep.Contract` for an Uplink. Tag it with the Topic id:

   ```csharp
   [SitrepTopic("avionics.status")]        // or [SitrepTopic("science.experiments", isArray: true)]
   public sealed class AvionicsStatus { /* ... */ }
   ```

   The tag is a **typing marker only**; it does not change the wire. The bytes are written by `Sitrep.Core.Serialization.JsonWriter` walking the provider's live value tree, and this type mirrors that shape so codegen has something concrete to name. Untagged, the Topic resolves to `unknown` in the SDK.

2. **Declare the channel** on the owning uplink's `UplinkManifest.Channels`. `AddChannelSource`/`Publisher` throw without a matching declaration, by design:

   ```csharp
   new ChannelDeclaration {
       Topic = StatusTopic,
       Delivery = Delivery.LossyLatest,
       Delay = DelayRole.Delayed,          // or DelayRole.TrueNow for a fact about the here-and-now
       Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
   }
   ```

3. **Source it** in `Register(IUplinkHost host)`. Either a per-tick map, or the capture/courier split when the work is too heavy for the main loop:

   ```csharp
   host.AddChannelSource(AvailableTopic, _ => _a.IsAvailable);
   _status = host.Publisher(StatusTopic);
   host.AddSampledSource(CaptureOnMain, HandleOnCourier, StatusTopic); // last args gate the capture on subscription
   ```

4. **Run `pnpm codegen`.** It rebuilds the `*.Contract.Codegen` twins and regenerates `mod/sitrep-sdk/src/__generated__/` (`contract.ts`, `topic-map.ts`, `units.ts`, `command-map.ts`, `reckonability.ts`) plus `asyncapi.yaml`. **Until it runs, `channels: ['my.new.topic']` fails the `TopicId` typecheck with nothing pointing at the generator as the missing step.** An Uplink slice writes into its own `client/src/__generated__/`, never into `sitrep-sdk`, which stays core-only.

Nothing further is needed to reach a station: see the data-flow section above.

External Uplinks (mod-adjacent packages, not just built-in widgets) can also contribute UI into a host widget's named **augment slots** via `registerAugment`/`<AugmentSlot>`, without the host and the augment referencing each other directly. `Panel` mounts `<componentId>.sections` and `<componentId>.actions` for every widget, so an Uplink can reach one whose author declared no slot at all. See [creating-an-uplink.md](./creating-an-uplink.md).


## `@ksp-gonogo/components`

The built-in widget library. Each widget file calls `registerComponent()` on import; there is no central index that lists them. The orchestrator just imports the package and registration happens as a side effect.

Widgets declare the Topics they read as `channels` (e.g. `['vessel.altitude']`), typed against `TopicId` so a typo fails the build, plus `optionalChannels` for a read they can do without and `fields` for what the widget actually draws when that is narrower. `dataRequirements` is the older untyped form, still accepted. They also declare their `actions`, so the serial-input layer and the config modal know what they can do. Styling is [styled-components](https://styled-components.com/); widget and sub-component names follow BEM-inspired naming (`AltitudeGauge`, `AltitudeGauge__Value`).

**What declaring a channel does, and does not do.** It does **not** create the subscription: `useTelemetry` subscribes on its own, so a widget that reads a Topic it forgot to declare still gets data. What the declaration buys is three things:

- **the mount gate.** `RequiresGuard` (applied by the orchestrator, not by the widget) resolves each **required** channel to its owning Uplink by longest-prefix match against the `system.uplinkHealth` roster, and replaces the widget with that Uplink's own `health.detail` when the worst owner is not healthy. With no telemetry host at all it says so instead. `optionalChannels` are deliberately never passed to the guard, so they never block a render: that is the whole behavioural difference between the two lists
- **the typed read.** `defineTopicManifest({ channels, optionalChannels, fields })` returns the arrays plus a `useTelemetry` bound to their union, so reading an undeclared Topic through it is a compile error and declaration cannot drift from use. The bound hook is zero-runtime: it answers the same `Reading` the free hook does, for both lists
- **attribution.** `fields` is read by alarm attribution and trajectory currency; it never affects mounting

A widget that declares nothing is fine: a purely local control has nothing to gate on. A required channel whose owner cannot be resolved at all (no roster yet, or no Uplink claims the prefix) does not block either; the guard blocks only on a resolved, unhealthy owner.

## `@ksp-gonogo/app`

The Vite SPA. Key responsibilities:

- **Dashboard orchestrator**: a layout engine on [React Grid Layout](https://github.com/react-grid-layout/react-grid-layout). It reads the layout config and renders registered widgets by id; it hardcodes no widget. Positions are stored in **grid units** (column/row spans), not pixels, so layouts are resolution-independent. The serialised format stores a per-breakpoint map (`lg`, `md`, `sm`, ...) so the grid reflows across screen sizes. Per-instance widget config is stored alongside the layout.
- **Sitrep telemetry client**: `SitrepTelemetryProvider` mounts the live `WebSocketTransport` to the Gonogo mod and feeds it into `@ksp-gonogo/sitrep-client`'s `TelemetryClient`/`TimelineStore`, which `useTelemetry`/`useCommand` read from directly (see the Data flow section above).
- **kOS integration** rides the Gonogo mod's sitrep stream: script dispatch over the `kos.run` Uplink command and CPU discovery over the `kos.processors` channel. It degrades gracefully when no stream is mounted.
- **PeerJS integration**: the main screen is the peer host; stations connect as peers. Sitrep frames are relayed verbatim and on demand (`SitrepPeerRelay`, see the Data flow section); the older `data`-typed snapshot path carries everything else, and stations send state back over it (e.g. GO/NO-GO votes).
- **Station config** is localStorage-first. Stations can request a config from the main screen over PeerJS, and the main screen can push saved configs to connecting stations.

## Extension pattern

Widgets and themes self-register at module load, and the orchestrator renders whatever is in the registry. There is no central list of widgets and nothing is hardcoded.

**If you are extending gonogo from outside this repo, the document you want is [creating-an-uplink.md](./creating-an-uplink.md), not this one.** An extension is an **Uplink**, and it registers through the published `@ksp-gonogo/sitrep-sdk`:

```ts
import { registerComponent } from '@ksp-gonogo/sitrep-sdk';
```

`@ksp-gonogo/core` is `private: true` and unpublished, so an Uplink can neither install nor build against it. The rest of this section describes how a widget INSIDE this repo registers, which is the same shape reached through the internal package:

```ts
import { registerComponent } from '@ksp-gonogo/core';

registerComponent({
  id: 'my-custom-gauge',
  name: 'My Custom Gauge',
  description: 'What an operator sees on this tile, in one sentence.',
  tags: ['telemetry'],
  component: MyCustomGauge,
  channels: ['vessel.altitude'],
  actions: [],            // declare what the widget can do (serial input maps onto these)
  defaultConfig: {},
});
```

```ts
import { registerTheme } from '@ksp-gonogo/core';

registerTheme({
  id: 'retro-nasa',
  name: 'Retro NASA',
  theme: { colors: { /* ... */ }, fonts: { /* ... */ } }, // passed to the styled-components ThemeProvider
});
```

The built-in `@ksp-gonogo/components` package models this pattern exactly; the orchestrator does not treat it as special, and it reaches the same registry an Uplink's `registerComponent` does. Themes are runtime-switchable: the `ThemeProvider` is driven by the active theme from the registry, never hardcoded at build time.

## Serial input platform

`@ksp-gonogo/serial` is a per-screen input layer that maps physical (or virtual) USB controllers onto widget actions. Device types are user-defined at runtime; device instances are per-screen (localStorage) and come in `web-serial` (real USB) and `virtual` (in-memory) transports. Serial events stay on the screen where the device is plugged in; they are **not** broadcast over PeerJS. See [`packages/serial/README.md`](../packages/serial/README.md) for the full walkthrough.

## Performance budgets

`PerfBudget` tracks rolling-window event rates, warns when a soft cap is breached, and fails any test that pushes a budget over its threshold (`PerfBudget.installTestGate()`, wired into each package's `setupFiles`). The `Perf Budgets` dashboard widget shows every registered budget live. It is exported from `@ksp-gonogo/core` and from `@ksp-gonogo/sitrep-sdk`.

**A new data source must register a sample-rate or dispatch-rate budget.** These are the highest-frequency surfaces in the app, and the budget catches a runaway poll, a misconfigured socket, and a duplicated subscription. Construct it at module scope; it self-registers, and the dashboard widget picks it up.

```ts
import { PerfBudget } from '@ksp-gonogo/core';

const MY_SOURCE_BUDGET = new PerfBudget({
  name: 'MySource samples in/sec',
  threshold: 1500,   // aim ~3-5x realistic steady state
  windowMs: 1000,
  unit: 'samples',
});

// then MY_SOURCE_BUDGET.record() on each sample
```

**What is in scope:** anything implementing `DataSource`, and any wrapper that fans samples out to subscribers (`BufferedDataSource`, the peer-broadcast wrapper, `SitrepPeerRelay`, which carries two of its own). Record dispatch rate for a pull-style source and emit rate for a push-style one. **Adding a Topic is not in scope**: it rides the one WebSocket and the budgets that already meter it. No gate enforces this rule, so it is on the author.
