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
milestone's proof: typed telemetry in, typed command out, hooks reactive, no
real transport.

## What's out of scope here (M3+)

This milestone (M2, "core spine") is deliberately synchronous and
zero-latency. Deferred to later milestones:

- **Delay** — configurable one-way light-speed delay between dispatch and
  delivery. The client's timing is isolated to `dispatch`/`handleMessage`
  today specifically so a scheduler can be inserted later without changing
  this package's public shape.
- **Courier / archive / Vantage** — the DTN-style courier boundary, contact-
  plan routing, the per-vessel archive with monotonic cursors, and Vantage as
  a connection parameter, all driven by a stub network graph.
- **Real transports** — WebSocket and PeerJS implementations of `Transport`,
  replacing `StubTransport` in real usage without any change to
  `TelemetryClient` or the hooks.

See `docs/superpowers/plans/2026-07-06-telemetry-mod-roadmap.md` for the full
milestone breakdown.
