import {
  PROCESSOR_EVAL_BUDGET,
  PROCESSOR_NOTIFY_BUDGET,
} from "@ksp-gonogo/core";
import {
  PRODUCTION_DERIVED_CHANNELS,
  setProcessorEvaluationRecorder,
  setProcessorNotificationRecorder,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import type { Meta } from "@ksp-gonogo/sitrep-sdk";
import {
  createFakeWallClock,
  type FakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import type { JSX, ReactNode } from "react";
/**
 * A stream test adapter: a real `TelemetryProvider` and
 * `TelemetryClient`/`TimelineStore` pipeline over a `StubTransport`, which
 * delivers only once something has subscribed, exactly like production.
 *
 * - `carriedChannels` is required: a caller states which topics (read and
 *   command) the fixture carries, and nothing is promoted silently
 * - `pinnedUt` pins the view clock via `scrubTo`, which wins outright over
 *   the delay computation, so a nonzero `delaySeconds` needs `pinnedUt`
 *   unset and time driven with `fixture.wall.advanceBy(seconds)`
 * - `suspendFrames` stops the clock's self-rescheduling frame loop, which
 *   otherwise mints a React update every frame so `act()` never sees an
 *   empty queue. Frames then come from `fixture.emitFrame()`, and `emit()`
 *   publishes its sample synchronously on a frame minted for both clock and
 *   store. One emit is one frame; to land several topics on a single frame,
 *   emit through `fixture.transport.emit` and call `emitFrame()` once
 */
export interface StreamFixtureOptions {
  /** Topics (read AND command) to promote into the carried-channels allowlist. */
  carriedChannels: Iterable<string>;
  /** UT to pin the view clock at, via `clock.scrubTo`. Omit to leave the clock live, which `delaySeconds` needs. */
  pinnedUt?: number;
  /** Fixed network/display delay in seconds. Defaults to 0. */
  delaySeconds?: number;
  /** Stop the view clock's frame loop before anything subscribes, leaving `emitFrame()` the only frame source. */
  suspendFrames?: boolean;
  /** Derived channels not to register, by topic: an address on one then resolves to a topic nothing publishes. */
  withoutDerivedChannels?: readonly string[];
}

export interface StreamFixture {
  transport: StubTransport;
  client: TelemetryClient;
  store: TimelineStore;
  wall: FakeWallClock;
  /** Wraps `children` in the `TelemetryProvider` this fixture built. */
  Provider: (props: { children: ReactNode }) => JSX.Element;
  /** `transport.emit`, subscription-gated, plus the frame that publishes it when `suspendFrames` is set. */
  emit: (
    topic: string,
    payload: unknown,
    metaOverrides?: Partial<Meta>,
  ) => void;
  /** Mint one frame synchronously, clock and store both, the manual half of `suspendFrames`. */
  emitFrame: () => void;
}

export function setupStreamFixture(opts: StreamFixtureOptions): StreamFixture {
  // The real budgets, so the PerfBudget gate sees processor churn.
  setProcessorEvaluationRecorder(() => PROCESSOR_EVAL_BUDGET.record());
  setProcessorNotificationRecorder(() => PROCESSOR_NOTIFY_BUDGET.record());
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => opts.delaySeconds ?? 0,
  });
  // A `.`-terminated carried channel is a dynamic whole-topic namespace, so `fleet.<guid>.delay` is sampled whole rather than split into `<parent>.<field>`.
  const carriedList = Array.from(opts.carriedChannels);
  const store = new TimelineStore(clock, {
    dynamicWholeTopicPrefixes: carriedList.filter((t) => t.endsWith(".")),
  });
  // The production derived-channel list, so a channel added there is available here by construction.
  const omitted = new Set(opts.withoutDerivedChannels ?? []);
  for (const channel of PRODUCTION_DERIVED_CHANNELS) {
    if (omitted.has(channel.topic)) continue;
    store.registerDerivedChannel(channel);
  }
  if (opts.pinnedUt !== undefined) {
    clock.scrubTo(opts.pinnedUt);
    // The store minted its first frame before the pin; a widget mounted on it would re-render on the next frame, which under suspendFrames lands after the test.
    store.beginFrame();
  }
  // Suspended before the Provider mounts: a loop that got one tick in has already scheduled the next.
  const framesSuspended = opts.suspendFrames === true;
  if (framesSuspended) clock.suspendFrames();

  /**
   * One frame carried all the way to the render: `store.beginFrame()` is what
   * a reactive read watches, and the provider only calls it on a
   * `requestAnimationFrame`, so it is called here synchronously.
   */
  const mintFrame = () => {
    clock.emitFrame();
    store.beginFrame();
  };

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
      if (framesSuspended) mintFrame();
    },
    emitFrame: mintFrame,
  };
}

let emitsMuted = false;

/**
 * Suppress every fixture emit, so a test runs against a widget fed nothing.
 * The mechanism behind `unfed-snapshot-gate.ts`: a snapshot test that still
 * passes with this on is capturing an un-fed render. Call it only from
 * `src/test/setup.ts`, the one node-only place the env var is read, since
 * this module is also bundled for the browser. There is deliberately no
 * un-mute: flipping it mid-suite would make results depend on order.
 */
export function muteFixtureEmits(): void {
  emitsMuted = true;
}

/**
 * Whether {@link muteFixtureEmits} is in force, for the other feed path: the
 * `MockDataSource` emits in `widgetDomSnapshot` and the legacy reshapes
 * derived from them. Both halves starve together.
 */
export function fixtureEmitsMuted(): boolean {
  return emitsMuted;
}
