import type { JSX, ReactNode } from "react";
import type { Meta } from "../__generated__/contract";
import {
  PRODUCTION_DERIVED_CHANNELS,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "../spine";
import { createFakeWallClock, type FakeWallClock } from "./fake-wall-clock";
import { StubTransport } from "./stub-transport";

/**
 * A widget test that genuinely runs OFF THE STREAM: a real `TelemetryProvider`
 * over a real `TelemetryClient`/`TimelineStore`/`ViewClock`, fed by hand-authored
 * per-test emissions.
 *
 * This is the REAL spine, not a stand-in. That is the point of publishing it: a
 * third-party Uplink author should be running the same pipeline the app runs, and
 * an in-memory reimplementation of it would leave their tests passing while
 * testing the reimplementation.
 *
 * It used to live a package above this one, on the reasoning that the sdk is the
 * leaf and so could not reach the spine at all. That turned out to be a fact
 * about where the spine was STORED rather than what it depended on: the whole
 * read-and-stream cluster's transitive imports were the sdk and itself, so it
 * moved here (`../spine`) and this fixture came with it. Nothing was
 * reimplemented to make that happen, which is the only version of this worth
 * having.
 *
 * It replaces nine copies of itself. Every Uplink carried its own
 * `src/test/setupStreamFixture.tsx`, five byte-identical and the other four
 * varying only in the derived channels they registered. It registers
 * `PRODUCTION_DERIVED_CHANNELS`, the same list the provider registers, so every
 * caller gets every channel rather than discovering which one their widget
 * needed.
 *
 * - **`StubTransport`** (not `ReplayTransport`): subscription-gated exactly like
 *   production, `emit` only delivers once something has actually subscribed, so a
 *   test that renders a widget and sees the value proves the widget's own
 *   `useStream`/shim ref-count genuinely subscribed. A test that wants to replay a
 *   whole recording should build a `ReplayTransport` directly.
 * - **`carriedChannels`** is required, not defaulted: a caller states which topics
 *   (read AND command) this fixture carries and nothing is silently promoted,
 *   mirroring the production allowlist's explicit-promotion contract. A
 *   `.`-terminated entry is a DYNAMIC whole-topic namespace, so a 3+-segment topic
 *   (`fleet.<guid>.delay`) is sampled whole rather than mis-split into a
 *   `<parent>.<field>` the wire never publishes.
 * - **`delaySeconds`**: the one knob the whole streaming pipeline exists for. A
 *   caller passing a nonzero value MUST leave `pinnedUt` unset, because
 *   `ViewClock.viewUt()`'s `scrubTo` target wins outright over the
 *   confirmed-edge/delay computation, which makes a pinned clock silently turn
 *   `delaySeconds` into a no-op. Drive time with `fixture.wall.advanceBy(seconds)`
 *   plus `fixture.store.beginFrame()` instead, which applies it deterministically.
 *   Ingests are not the only frame source: a mounted `TelemetryProvider` also
 *   mints one every animation frame off `ViewClock.onFrame`, whether or not
 *   anything arrived.
 */
export interface StreamFixtureOptions {
  /** Topics (read AND command) to promote into the carried-channels allowlist. */
  carriedChannels: Iterable<string>;
  /** UT to pin the view clock at, via `clock.scrubTo`. Omit to leave the clock live (required for `delaySeconds` to have any effect; see this file's doc comment). */
  pinnedUt?: number;
  /** Fixed network/display delay in seconds (`ViewClock`'s delay authority). Defaults to 0. */
  delaySeconds?: number;
}

export interface StreamFixture {
  transport: StubTransport;
  client: TelemetryClient;
  store: TimelineStore;
  wall: FakeWallClock;
  /** Wraps `children` in the `TelemetryProvider` this fixture built. */
  Provider: (props: { children: ReactNode }) => JSX.Element;
  /**
   * Open a standing subscription for a topic, the way a mounted widget does.
   *
   * A `StubTransport.emit` is subscription-gated, so a test that emits before
   * anything has subscribed drops the payload silently. Widgets subscribe on
   * mount, so tests that render one need this only for topics no widget under
   * test reads: a presence gate, a sibling's topic, the raw inputs of a derived
   * channel.
   *
   * Here rather than on the client, because holding a `TelemetryClient` is not
   * something an Uplink test should have to do to say "subscribe".
   */
  subscribe: (topic: string, cb?: (payload: unknown) => void) => void;
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
  const carriedChannels = Array.from(opts.carriedChannels);
  const store = new TimelineStore(clock, {
    dynamicWholeTopicPrefixes: carriedChannels.filter((t) => t.endsWith(".")),
  });
  // The production list itself rather than a hand-picked four of it. The four
  // were the ones some Uplink's widget happened to need, so a widget reading any
  // of the other four got `undefined` from a store the app would have answered
  // from, and the test agreed with itself. Registering the same list the provider
  // registers is the only version of this that stays true as the list grows.
  for (const channel of PRODUCTION_DERIVED_CHANNELS) {
    store.registerDerivedChannel(channel);
  }
  if (opts.pinnedUt !== undefined) clock.scrubTo(opts.pinnedUt);

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
    subscribe: (topic, cb) => {
      client.subscribe(topic, cb ?? (() => {}));
    },
    emit: (topic, payload, metaOverrides) =>
      transport.emit(topic, payload, metaOverrides),
  };
}
