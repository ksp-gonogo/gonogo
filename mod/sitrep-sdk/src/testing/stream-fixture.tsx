import type { JSX, ReactNode } from "react";
import type { Meta } from "../__generated__/contract";
import {
  DYNAMIC_WHOLE_TOPIC_PREFIXES,
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
 * It registers `PRODUCTION_DERIVED_CHANNELS`, the same list the provider
 * registers, so every caller gets every derived channel.
 *
 * - **`StubTransport`** (not `ReplayTransport`): subscription-gated exactly
 *   like production, `emit` only delivers once something has actually
 *   subscribed, so a test that renders a widget and sees the value proves the
 *   widget's own `useStream`/shim ref-count genuinely subscribed. A test that
 *   wants to replay a whole recording should build a `ReplayTransport`
 *   directly.
 * - **Dynamic namespaces** resolve as production's do: a topic under one of
 *   `DYNAMIC_WHOLE_TOPIC_PREFIXES` (`fleet.<guid>.delay`) is sampled whole rather
 *   than mis-split into a `<parent>.<field>` the wire never publishes.
 * - **`delaySeconds`**: the one knob the whole streaming pipeline exists for. A
 *   caller passing a nonzero value MUST leave `pinnedUt` unset, because
 *   `ViewClock.viewUt()`'s `scrubTo` target wins outright over the
 *   confirmed-edge/delay computation, which makes a pinned clock silently turn
 *   `delaySeconds` into a no-op. Drive time with
 *   `fixture.wall.advanceBy(seconds)` plus `fixture.store.beginFrame()`
 *   instead, which applies it deterministically. Ingests are not the only frame
 *   source: a mounted `TelemetryProvider` also mints one every animation frame
 *   off `ViewClock.onFrame`, whether or not anything arrived.
 *
 * @category Stream fixture
 */
export interface StreamFixtureOptions {
  /** UT to pin the view clock at, via `clock.scrubTo`. Omit to leave the clock live (required for `delaySeconds` to have any effect; see this file's doc comment). */
  pinnedUt?: number;
  /** Fixed network/display delay in seconds (`ViewClock`'s delay authority). Defaults to 0. */
  delaySeconds?: number;
}

/**
 * What `setupStreamFixture` returns: the stub transport, the real client and
 * store behind it, a fake wall clock, and a `Provider` to render widgets inside.
 *
 * @category Stream fixture
 */
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

/**
 * Builds a real telemetry pipeline over a `StubTransport`, for a test to feed by
 * hand. Render the widget under test inside `Provider`, then `emit` payloads to
 * it.
 *
 * @category Stream fixture
 */
export function setupStreamFixture(
  opts: StreamFixtureOptions = {},
): StreamFixture {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => opts.delaySeconds ?? 0,
  });
  const store = new TimelineStore(clock, {
    dynamicWholeTopicPrefixes: DYNAMIC_WHOLE_TOPIC_PREFIXES,
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
      <TelemetryProvider client={client} store={store}>
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

/**
 * Stage the link dropping out of a scene: the transport disconnects and a
 * frame is minted, so every reading the scene drew is held rather than
 * current. What a fixture's `"_stream": { "stopsArriving": true }` asks for.
 *
 * The drop rather than a clock advance, because it is what a widget's own
 * held-reading tests do (`store.setTransportConnected(false)`), so a fixture
 * and the test asserting on it stage the same thing. Call it after the scene's
 * emits: that is the order an operator meets it, and a drop first would leave
 * the emits nowhere to land.
 *
 * @category Stream fixture
 */
export function stopArriving(stream: StreamFixture): void {
  stream.store.setTransportConnected(false);
  stream.store.beginFrame();
}
