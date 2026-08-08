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
 * A stream test-adapter, minimal version: a widget's test needs to
 * genuinely run OFF THE STREAM (a real `TelemetryProvider` + a real
 * `TelemetryClient`/`TimelineStore` pipeline, the same one `useProcessor`'s
 * evaluator reads its frame source from), not the legacy `MockDataSource`
 * registry. Byte-for-byte copy of the sibling Uplinks' test adapter
 * of the same name: see either's own doc comment for the full rationale
 * (StubTransport vs. ReplayTransport, the FixedViewClock pattern, why
 * `carriedChannels` is required rather than defaulted).
 */
export interface StreamFixtureOptions {
  /** Topics (read AND command) to promote into the carried-channels allowlist. */
  carriedChannels: Iterable<string>;
  /** UT to pin the view clock at, via `clock.scrubTo`. Omit to leave the clock live. */
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
