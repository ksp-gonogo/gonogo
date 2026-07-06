# @gonogo/sitrep-client

`@gonogo/sitrep-*` is the Gonogo telemetry mod, codename Sitrep.

The app-side core spine for the gonogo-native telemetry mod: the React layer
that sits between a `Transport` (a dumb typed message pipe to a telemetry
source) and the components that render live values and fire commands.

This package owns subscription bookkeeping, command lifecycle tracking, and
the React hooks that make both reactive — it does not know or care what's on
the other end of the transport.

## The `Transport` boundary

```ts
interface Transport {
  readonly status: TransportStatus; // "connected" | "disconnected" | "reconnecting" | "error"
  send(message: ClientMessage): void;
  onMessage(listener: (message: ServerMessage) => void): () => void;
  onStatusChange(listener: (status: TransportStatus) => void): () => void;
}
```

`Transport` routes the `@gonogo/sitrep-sdk` wire messages
(`subscribe`/`unsubscribe`/`command-request` out, `stream-data`/
`command-response`/`error` in) and nothing else — topics, subscriptions, and
command correlation are all handled above this boundary, in
`TelemetryClient`.

`StubTransport` is the only implementation in this milestone: an in-memory,
scriptable fake for tests, with `emit(topic, payload)` to fake inbound stream
data and `setCommandHandler(fn)` to answer `command-request`s. Real
implementations — WebSocket, PeerJS — arrive in later milestones and plug
into the exact same interface; nothing above the `Transport` boundary changes
when they do.

## `TelemetryClient`

Wraps a `Transport` and provides:

- **Ref-counted topic subscriptions** — `transport.send({ type: "subscribe" })`
  fires only on the first subscriber for a topic, `unsubscribe` only on the
  last one leaving. A sticky last-value cache means a late subscriber gets
  the current value immediately, without waiting for the next sample.
- **Command dispatch** — `dispatch(command, args)` returns a `requestId` and a
  `Promise` that resolves/rejects once the correlated `command-response` or
  `error` arrives. Even at this milestone's zero simulated latency, a
  response is never delivered synchronously within the same call stack as the
  request — the `in-flight` phase is always observable, because a real
  transport never resolves in the same tick as the send.

## Hooks

`TelemetryProvider` supplies a `TelemetryClient` to the tree via context;
`useTelemetryClient()` reads it.

- **`useStream<T>(topic: string): T | undefined`** — reactively reads the
  latest value for a topic (`useSyncExternalStore` over the client's
  ref-counted subscription). Renders `undefined` until the first sample
  arrives, then re-renders on every subsequent one. Unmounting releases the
  subscription; when the last subscriber for a topic goes away, the client
  sends `unsubscribe` to the transport.
- **`useCommand(command: string): { send, status }`** — `send(args?)`
  dispatches the command and returns the same `Promise` `dispatch` produces;
  `status` reactively reflects the lifecycle (`idle -> in-flight ->
  confirmed | failed`) via `useSyncExternalStore`.

## Example

```tsx
import {
  TelemetryClient,
  TelemetryProvider,
  StubTransport,
  useStream,
  useCommand,
} from "@gonogo/sitrep-client";

function MissionPanel() {
  const altitude = useStream<number>("v.alt");
  const { send, status } = useCommand("stage");
  return (
    <div>
      <span>altitude: {altitude ?? "—"}</span>
      <button onClick={() => send()} disabled={status.phase === "in-flight"}>
        stage
      </button>
    </div>
  );
}

const client = new TelemetryClient(new StubTransport());

<TelemetryProvider client={client}>
  <MissionPanel />
</TelemetryProvider>;
```

`src/integration.test.tsx` exercises exactly this shape end-to-end — through
a real `TelemetryProvider`, `TelemetryClient`, and `StubTransport` — as the
M2 milestone's proof: typed telemetry in, typed command out, hooks reactive,
no real transport.

## Delayed comms (M3)

Delayed streams and delayed command round trips now work, with nothing above
the `Transport` boundary changing. `@gonogo/sitrep-server`'s `Courier` +
`CourierTransport` implement the exact same `Transport` interface
`StubTransport` does — swap the transport passed to `TelemetryClient` and
every hook behaves identically, just lagged by whatever network delay the
courier's `StubNetwork` is configured with:

- **`useStream`** renders `undefined` until a sample's delay elapses, then
  the delayed value — same "sticky last value" contract as M2, just later.
- **`useCommand`**'s `in-flight` status now carries a real `etaConfirm`
  (`CourierTransport.predictConfirmEta()`, rather than the same-tick
  fallback `StubTransport` produces), and a command whose node goes
  unreachable resolves to the `lost` phase once silence outlasts
  `etaConfirm + LOSS_MARGIN` (see `LOSS_MARGIN` and the `Clock` seam in
  `client.ts`/`clock.ts` — the client infers loss from a transport-predicted
  ETA, it never computes delay itself).
- **Delay 0 collapses to M2**: an unconfigured `StubNetwork` pair (or
  `setScale(0)`) makes the courier deliver immediately, matching
  `StubTransport`'s zero-latency behavior exactly.

`src/delayed-integration.test.tsx` is the M3 proof: the same
`useStream`+`useCommand` component as the M2 test, wired to a real
`ManualClock` + `StubNetwork` + `Courier` + `CourierTransport` sharing one
clock with the `TelemetryClient` — asserting a lagged stream value, an
in-flight `etaConfirm` that resolves to `confirmed` after the full
uplink+downlink round trip, and a `lost` status when the node is
unreachable. See `mod/sitrep-server/README.md` for the delay-engine
internals (`Clock`/`Network`/`Archive`/`Courier`/`CourierTransport`).

## What's out of scope here (M3b+)

- **Contact-plan routing** (moving relays, CGR, store-and-forward) — M3b,
  lives entirely in `@gonogo/sitrep-server`'s `Network`/`Courier`; this
  package's `Transport` boundary doesn't change either way.
- **Real transports** — WebSocket and PeerJS implementations of `Transport`,
  replacing `StubTransport`/`CourierTransport` in real usage without any
  change to `TelemetryClient` or the hooks.
- **A real RemoteTech-style `[H]` signal-delay handler** wired into the
  actual C# mod — M5. This package and `sitrep-server` are the app-side and
  reference-engine halves of the design, not the mod itself.

See `docs/superpowers/plans/2026-07-06-telemetry-mod-roadmap.md` for the full
milestone breakdown.
