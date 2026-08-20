import {
  createFakeWallClock,
  type FakeWallClock,
  PRODUCTION_DERIVED_CHANNELS,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import type { JSX, ReactNode } from "react";

/**
 * The stream test-adapter, minimal version: a migrated widget's test needs
 * to genuinely run OFF THE STREAM (a real `TelemetryProvider` + a real
 * `TelemetryClient`/`TimelineStore` pipeline), not the legacy
 * `MockDataSource` registry. Built for the WarpControl pilot; scoped to what
 * it needs, a fuller legacy bulk-fixture-converter is
 * later work once more widgets migrate.
 *
 * - **`StubTransport`** (not `ReplayTransport`): this adapter is for
 *   hand-authored, per-test wire emissions (`fixture.emit(topic, payload)`),
 *   subscription-gated exactly like production (`StubTransport.emit` only
 *   delivers once something has actually subscribed, proving the widget's
 *   `useStream`/shim ref-count genuinely subscribed, a real correctness
 *   signal). A widget test that wants to replay a full recording instead
 *   should build its own `ReplayTransport` directly.
 * - **`FixedViewClock` pattern**: `new ViewClock({ nowWall: wall.now,
 *   warpRate: () => 1, delaySeconds: () => opts.delaySeconds ?? 0 })`,
 *   pinned via `scrubTo` when `pinnedUt` is supplied, the SDK analog of the
 *   visual-gate's pinned `Date.now()`. `wall` is exposed (via the
 *   now-exported `createFakeWallClock`) for a test that needs to advance it
 *   explicitly.
 * - **`carriedChannels`** is required, not defaulted, a caller must state
 *   which topics (read AND command) this fixture carries; nothing is
 *   silently promoted (mirrors the production allowlist's own "explicit
 *   dev-first promotion" contract, `TelemetryProvider`'s own doc comment).
 * - **`delaySeconds`**: every dual-run/stream test up to this point
 *   hardcoded `delaySeconds: () => 0`: the ONE knob the whole streaming
 *   pipeline exists for was untested. A caller
 *   that supplies a nonzero `delaySeconds` MUST leave `pinnedUt` unset:
 *   `ViewClock.viewUt()`'s `scrubTo` target wins outright over the
 *   confirmed-edge/delay computation (see that method's own doc comment),
 *   so a pinned clock makes `delaySeconds` a no-op. Drive time with
 *   `fixture.wall.advanceBy(seconds)` (+ `fixture.store.beginFrame()` to
 *   apply it: nothing else triggers a frame between ingests) instead.
 */
export interface StreamFixtureOptions {
  /** Topics (read AND command) to promote into the carried-channels allowlist. */
  carriedChannels: Iterable<string>;
  /** UT to pin the view clock at, via `clock.scrubTo`. Omit to leave the clock live (required for `delaySeconds` to have any effect; see this file's doc comment). */
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
  /** `transport.emit`, forwarded for convenience: subscription-gated, same as calling it directly. */
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
  // A carried channel written as a `.`-terminated prefix sentinel (e.g.
  // "fleet." or any per-subject dynamic namespace) is a DYNAMIC whole-topic
  // namespace: tell the
  // store so a 3+-segment dynamic topic (fleet.<guid>.delay) is subscribed/
  // sampled whole, not mis-split into a `<parent>.<field>` the wire never
  // publishes. Exact (non-`.`-terminated) carried topics are unaffected.
  const carriedList = Array.from(opts.carriedChannels);
  const store = new TimelineStore(clock, {
    dynamicWholeTopicPrefixes: carriedList.filter((t) => t.endsWith(".")),
  });
  // The PRODUCTION list, not a hand-curated echo of it.
  //
  // This used to register a subset by name, and the subset had drifted:
  // `vesselManeuverLegacyChannel` was missing, so every caller of this helper
  // (including the probe and the visual gate) saw an EMPTY maneuver node list
  // while `vessel.maneuver` itself carried nodes. The ManeuverPlanner baselines
  // recorded "No maneuver nodes planned" for a craft that had one, and a burn
  // window rendered beside a list denying the burn existed. Two lists describing
  // one truth, and the fixture one was quietly wrong.
  //
  // Registering the production list means a channel added there is available
  // here by construction, so this cannot drift again.
  for (const channel of PRODUCTION_DERIVED_CHANNELS) {
    store.registerDerivedChannel(channel);
  }
  if (opts.pinnedUt !== undefined) clock.scrubTo(opts.pinnedUt);

  const carriedChannels = carriedList;

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
    emit: (topic, payload, metaOverrides) => {
      if (emitsMuted) return;
      transport.emit(topic, payload, metaOverrides);
    },
  };
}

let emitsMuted = false;

/**
 * Suppress every fixture emit, so a test runs against a widget that was fed
 * nothing at all.
 *
 * This is the mechanism behind `unfed-snapshot-gate.ts`, not a debugging knob.
 * A snapshot test that still PASSES with this on is, by definition, capturing an
 * un-fed render: its committed baseline is the widget's empty state, whatever the
 * scenario is named. That check is exact rather than heuristic, which is what
 * makes it worth a gate.
 *
 * It exists because `AtmosphereProfile` had six scenarios named after six
 * different atmospheres and all 48 committed renders were the string
 * "ATMOSPHERE PROFILE Waiting for body telemetry...", and `SpaceCenterStatus` had
 * 48 more whose every facility level was an em dash. Textual detectors missed the
 * second one entirely, because its empty state is punctuation rather than a
 * sentence. Only suppressing the data found it.
 *
 * CALL THIS FROM `src/test/setup.ts` AND NOWHERE ELSE. The gate mutes a whole
 * vitest run via `GONOGO_MUTE_FIXTURE_EMITS=1`, and that env var is read there,
 * in the one place that only ever runs under node. This module is also bundled
 * for the BROWSER (the probe entry imports it for stream-driven widget renders),
 * where reading `process` at module scope threw `process is not defined` and took
 * the whole render harness down for a day, see `probe-render-smoke.ts`. There is
 * deliberately no un-mute: a test that flipped this mid-suite would make its own
 * neighbours' results depend on order.
 */
export function muteFixtureEmits(): void {
  emitsMuted = true;
}
