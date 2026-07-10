# @ksp-gonogo/sitrep-server

`@ksp-gonogo/sitrep-*` is the Gonogo telemetry mod, codename Sitrep.

This package is the TypeScript **reference implementation** of the mod's
game-side delay engine — a proving ground for the design before it's ported
to C#/KSP. It models the one thing `@ksp-gonogo/sitrep-client` deliberately
doesn't: point-to-point light-time delay between a Vantage (an observer, e.g.
`"KSC"`) and a node (e.g. a vessel id), for both telemetry streams and
command round trips.

## The pieces

- **`Clock`** — the injectable virtual-time seam. All delay-sensitive
  scheduling reads time exclusively through a `Clock`, never
  `Date.now()`/`performance.now()` directly, so it runs deterministically
  under KSP time-warp and in tests. `ManualClock` only advances when
  `advanceTo(ut)` is called (the workhorse for every test in this package);
  `RealClock` backs production use.
- **`StubNetwork`** — the scriptable point-to-point network model: a scalar
  one-way delay and a boolean reachability per `(vantage, node)` pair, plus a
  global `scale` multiplier (`scale = 0` collapses every delay to zero —
  M2-equivalent instant delivery; `scale = 1`, the default, is unscaled).
  Point-to-point only — no contact-plan routing, moving relays, or CGR; that's
  **M3b**.
- **`Archive`** — the single per-node SCET-stamped sample history. One
  archive per node (per topic within it); each Vantage reads through it via
  its own monotonic cursor at its own delay offset, so every observer sees
  its own light-lagged scene of the same underlying truth.
- **`Courier`** — the delay engine itself, sitting on top of `Clock` +
  `Network` (+ one `Archive` per node). `record()` schedules delayed delivery
  of a stream sample to every current subscriber; `dispatchCommand()` models
  a symmetric uplink/downlink round trip (execute at `t0 + up`, confirm at
  `t0 + up + down`) and drops the command in honest silence if the node is
  unreachable at dispatch time — no error response, just nothing, matching
  how a real light-time gap behaves. `roundTripEta()` exposes the same
  round-trip model so a client can predict a command's ETA without
  duplicating the uplink === downlink assumption.
- **`CourierTransport`** — adapts one `Courier` connection (a single active
  node observed from a single vantage) to the `Transport` interface
  `@ksp-gonogo/sitrep-client`'s `TelemetryClient` consumes. This is what lets the
  unchanged M2 client receive delayed streams and delayed command round trips
  — from the client's point of view it's just a `Transport`, same as
  `StubTransport` in M2 tests. `predictConfirmEta()` hands back
  `clock.now() + courier.roundTripEta(...)`, which is what powers the
  client's own loss-inference timer (see sitrep-client's `TelemetryClient`)
  without the client ever computing delay itself.

## Delay 0 collapses to M2

`StubNetwork`'s default delay is `0` per pair, and `setScale(0)` zeroes every
pair regardless of base delay. Either way, `Courier`/`CourierTransport`
degrade to immediate (same-tick-adjacent) delivery — the exact behavior of
M2's `StubTransport`, just routed through the real courier/archive machinery
instead of a hand-rolled fake. Nothing in `@ksp-gonogo/sitrep-client` needs to
know or care which one it's talking to.

## What this package is not (yet)

- **Contact-plan routing** (moving relays, CGR, store-and-forward) — **M3b**.
- **A real RemoteTech `[H]`-style signal-delay handler** wired into the
  actual C# mod — **M5**. This package is the TS proving-implementation the
  mod's delay engine gets ported from, not the mod itself.
- Media/asset/session/`EVENT` payload classes, PeerJS station-as-vantage,
  Principia propagation — all out of scope for M3, tracked in the roadmap doc
  below.

See `docs/superpowers/plans/2026-07-06-telemetry-mod-roadmap.md` for the full
milestone breakdown.

## Testing note: the cross-package integration proof lives in sitrep-client

`courier-transport.test.ts` in this package has a (test-only) devDependency
on `@ksp-gonogo/sitrep-client`, so it can drive a real `TelemetryClient` against
the courier directly. The reverse integration proof —
`packages/sitrep-client/src/delayed-integration.test.tsx`, which renders the
real `useStream`/`useCommand` hooks against this package's `Courier` +
`CourierTransport` — imports this package's modules by **relative path**
rather than the `@ksp-gonogo/sitrep-server` package specifier. That's
deliberate: adding a `sitrep-client -> sitrep-server` package.json edge on
top of the existing `sitrep-server -> sitrep-client` one closes a cycle that
`pnpm`/`turbo` can't schedule (`turbo build`/`typecheck` hard-errors with
"Cyclic dependency detected"). The relative import reaches the exact same
modules at runtime without adding a graph edge, and production code in
either package still never imports the other.
