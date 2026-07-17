import {
  createFakeWallClock,
  type FakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import type { JSX, ReactNode } from "react";

/**
 * A stream test-adapter, minimal version — a migrated widget's test needs
 * to genuinely run OFF THE STREAM (a real `TelemetryProvider` + a real
 * `TelemetryClient`/`TimelineStore` pipeline), not the legacy
 * `MockDataSource` registry. Built for the WarpControl pilot; scoped to
 * what it needs — a fuller `fromTelemachusFixture` bulk-fixture-converter
 * is later work once more widgets migrate.
 *
 * - **`StubTransport`** (not `ReplayTransport`) — this adapter is for
 *   hand-authored, per-test wire emissions (`fixture.emit(topic, payload)`),
 *   subscription-gated exactly like production (`StubTransport.emit` only
 *   delivers once something has actually subscribed — proving the widget's
 *   `useStream`/shim ref-count genuinely subscribed, a real correctness
 *   signal). A widget test that wants to replay a full
 *   recording instead should build its own `ReplayTransport` directly.
 * - **`FixedViewClock` pattern** — `new ViewClock({ nowWall: wall.now,
 *   warpRate: () => 1, delaySeconds: () => opts.delaySeconds ?? 0 })`,
 *   pinned via `scrubTo` when `pinnedUt` is supplied — the SDK analog of the
 *   visual-gate's pinned `Date.now()`. `wall` is exposed (via the
 *   now-exported `createFakeWallClock`) for a test that needs to advance it
 *   explicitly.
 * - **`carriedChannels`** is required, not defaulted — a caller must state
 *   which topics (read AND command) this fixture carries; nothing is
 *   silently promoted (mirrors the production allowlist's own "explicit
 *   dev-first promotion" contract, `TelemetryProvider`'s own doc comment).
 * - **`delaySeconds`**: every dual-run/stream
 *   test up to this point hardcoded `delaySeconds: () => 0` — the ONE
 *   knob the whole streaming pipeline exists for was untested. A caller
 *   that supplies a nonzero `delaySeconds` MUST leave `pinnedUt` unset:
 *   `ViewClock.viewUt()`'s `scrubTo` target wins outright over the
 *   confirmed-edge/delay computation (see that method's own doc comment),
 *   so a pinned clock makes `delaySeconds` a no-op. Drive time with
 *   `fixture.wall.advanceBy(seconds)` (+ `fixture.store.beginFrame()` to
 *   apply it — nothing else triggers a frame between ingests) instead.
 */
export interface StreamFixtureOptions {
  /** Topics (read AND command) to promote into the carried-channels allowlist. */
  carriedChannels: Iterable<string>;
  /** UT to pin the view clock at, via `clock.scrubTo`. Omit to leave the clock live (required for `delaySeconds` to have any effect — see this file's doc comment). */
  pinnedUt?: number;
  /** Fixed network/display delay in seconds (`ViewClock`'s delay authority). Defaults to 0, preserving every existing steady-state fixture's behavior untouched. */
  delaySeconds?: number;
}

export interface StreamFixture {
  transport: StubTransport;
  client: TelemetryClient;
  store: TimelineStore;
  wall: FakeWallClock;
  /** Wraps `children` in the `TelemetryProvider` this fixture built. */
  Provider: (props: { children: ReactNode }) => JSX.Element;
  /** `transport.emit`, forwarded for convenience — subscription-gated, same as calling it directly. */
  emit: (
    topic: string,
    payload: unknown,
    metaOverrides?: Partial<Meta>,
  ) => void;
}

export function setupStreamFixture(opts: StreamFixtureOptions): StreamFixture {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => opts.delaySeconds ?? 0,
  });
  const store = new TimelineStore(clock);
  store.registerDerivedChannel(vesselStateChannel);
  if (opts.pinnedUt !== undefined) clock.scrubTo(opts.pinnedUt);

  const carriedChannels = opts.carriedChannels;

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={carriedChannels}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return {
    transport,
    client,
    store,
    wall,
    Provider,
    emit: (topic, payload, metaOverrides) =>
      transport.emit(topic, payload, metaOverrides),
  };
}
