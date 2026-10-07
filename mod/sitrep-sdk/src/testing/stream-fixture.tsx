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
 * Options for {@link setupStreamFixture}.
 *
 * The fixture runs the app's own telemetry pipeline, with every derived Topic
 * registered, over a {@link StubTransport} a test feeds by hand:
 *
 * - `emit` delivers only once something has subscribed, as the mod does, so a
 *   widget that shows an emitted value has really subscribed
 * - A key under a dynamic prefix, such as `fleet.<guid>.delay`, is read whole,
 *   as the app reads it
 * - With a nonzero `delaySeconds`, leave `pinnedUt` unset, since a pinned
 *   clock ignores the delay. Move time with `fixture.wall.advanceBy(seconds)`
 *   and then `fixture.store.beginFrame()`. A mounted provider also starts a
 *   frame on every animation frame, whether or not anything arrived
 *
 * @category Stream fixture
 */
export interface StreamFixtureOptions {
  /** UT to pin the view clock at. Omit it to leave the clock running, which `delaySeconds` needs: a pinned clock ignores the delay. */
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
   * Opens a standing subscription to `topic`, as a mounted widget does. An
   * `emit` before anything has subscribed is dropped, so call this for a Topic no
   * widget under test reads, such as a presence check or the inputs of a derived
   * Topic.
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
 * @categoryDescription Stream fixture
 * Running a widget against a scripted stream in a test: a real telemetry client
 * over a stub transport, the values it delivers, and the commands it records.
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
 * Drops the link, as a widget's held-reading tests do: the transport
 * disconnects and a new frame starts, so every reading the widget drew is held
 * rather than current. What a fixture's `"_stream": { "stopsArriving": true }`
 * asks for. Call it after the scene's emits.
 *
 * @category Stream fixture
 */
export function stopArriving(stream: StreamFixture): void {
  stream.store.setTransportConnected(false);
  stream.store.beginFrame();
}
