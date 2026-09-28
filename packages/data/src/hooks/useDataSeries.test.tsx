import {
  dvCurrentStageResourceChannel,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  createFakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useDataSeries } from "./useDataSeries";

/**
 * `useDataSeries` builds its `SeriesRange` off the `TimelineStore`: straight
 * off `sampleRange` for a raw topic, or off `sampleDerivedRange` (a replay of
 * the channel's own `derive()` across its raw inputs' buffered ranges) for a
 * DERIVED one.
 */

function Probe({ dataKey, windowSec }: { dataKey: string; windowSec: number }) {
  const range = useDataSeries(dataKey, windowSec);
  return (
    <div data-testid="range">
      t:{range.t.join(",")}|v:{range.v.join(",")}|breaks:
      {(range.breaks ?? []).join(",")}
    </div>
  );
}

function BridgeProbe({
  dataKey,
  windowSec,
}: {
  dataKey: string;
  windowSec: number;
}) {
  const range = useDataSeries(dataKey, windowSec);
  return (
    <div data-testid="bridges">
      breaks:{(range.breaks ?? []).join(",")}|bridges:
      {(range.bridges ?? [])
        .map((b) => `${b.to}/${b.basis}/${b.v.length}`)
        .join(",")}
    </div>
  );
}

function readProbe(): string {
  return screen.getByTestId("range").textContent ?? "";
}

/**
 * Same pinned-clock fixture pattern as `setupStreamFixture`
 * (`@ksp-gonogo/components/src/test/setupStreamFixture.tsx`): inlined here so
 * `@ksp-gonogo/data`'s tests don't reach across to `@ksp-gonogo/components`.
 */
function buildStreamFixture(opts: {
  carriedChannels: Iterable<string>;
  pinnedUt?: number;
}) {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  /* A caller-provided `store` (as opposed to `TelemetryProvider`'s auto-built
     default) registers NO derived channels on its own, so the DERIVED-topic
     test below registers the one it reads, or it would silently fall through
     `resolveRawFieldSubtopic`. */
  store.registerDerivedChannel(dvCurrentStageResourceChannel);
  if (opts.pinnedUt !== undefined) clock.scrubTo(opts.pinnedUt);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={opts.carriedChannels}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return { transport, client, store, wall, Provider };
}

describe("useDataSeries: a field path streams from the ClientTimeline", () => {
  it("builds the series from the real TimelineStore", async () => {
    const fixture = buildStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 100,
    });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.orbit.sma" windowSec={300} />
      </fixture.Provider>,
    );

    // Nothing arrived on the stream yet.
    expect(readProbe()).toBe("t:|v:|breaks:");

    // A real subscription must have happened for this to deliver at all, StubTransport.emit is subscription-gated.
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    act(() => {
      fixture.transport.emit("vessel.orbit", { sma: 679_400 }, { validAt: 10 });
      fixture.transport.emit("vessel.orbit", { sma: 679_800 }, { validAt: 50 });
      fixture.transport.emit(
        "vessel.orbit",
        { sma: 680_000 },
        { validAt: 100 },
      );
    });

    await waitFor(() =>
      expect(readProbe()).toBe("t:10,50,100|v:679400,679800,680000|breaks:"),
    );
  });

  it("trims to the window, off real buffered timeline data", async () => {
    const fixture = buildStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 1000,
    });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.orbit.sma" windowSec={100} />
      </fixture.Provider>,
    );

    act(() => {
      // Well outside the [900, 1000] window pinned above.
      fixture.transport.emit("vessel.orbit", { sma: 1 }, { validAt: 10 });
      fixture.transport.emit("vessel.orbit", { sma: 2 }, { validAt: 950 });
      fixture.transport.emit("vessel.orbit", { sma: 3 }, { validAt: 1000 });
    });

    await waitFor(() => expect(readProbe()).toBe("t:950,1000|v:2,3|breaks:"));
  });

  /**
   * A blackout hole reaches the chart as an INDEX, not as an absence to be
   * inferred.
   *
   * `Meta.gapSinceUt` says "there is no data between that UT and this sample's
   * own". The store has carried it since the recorder landed, and the series
   * boundary threw it away: `SeriesRange` was `{t, v}` and nothing else, so a
   * chart joined the last pre-outage reading straight to the first post-outage
   * one and drew a line the operator cannot tell from data. This is the index
   * that lets a chart break the path instead.
   */
  it("carries a gapSinceUt sample through as a break index", async () => {
    const fixture = buildStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 100,
    });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.orbit.sma" windowSec={300} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.transport.emit("vessel.orbit", { sma: 1 }, { validAt: 10 });
      fixture.transport.emit("vessel.orbit", { sma: 2 }, { validAt: 20 });
      // The outage ran from UT 20 to UT 90 and this channel does not record, so the sample that resumes it names the hole it is on the far side of.
      fixture.transport.emit(
        "vessel.orbit",
        { sma: 3 },
        { validAt: 90, gapSinceUt: 20 },
      );
      fixture.transport.emit("vessel.orbit", { sma: 4 }, { validAt: 100 });
    });

    // Index 2 is the resuming sample: no data between t[1] (20) and t[2] (90).
    await waitFor(() =>
      expect(readProbe()).toBe("t:10,20,90,100|v:1,2,3,4|breaks:2"),
    );
  });

  /**
   * Under high warp one physics tick outruns the mod's one-second sampling, so
   * two samples a tick apart have nothing observed between them. A distance
   * carried by its last velocity is honest for seconds, so a line joining two
   * of them that differ is drawn across two thousand seconds nobody saw.
   *
   * The flat run beside it is the control: the emitter withholds only a sample
   * that compares equal, so two equal samples are what every unsent one said.
   */
  it("breaks a moved value across a warped tick its model cannot carry, and joins a flat one", async () => {
    const fixture = buildStreamFixture({
      carriedChannels: ["vessel.dock", "time.warp"],
      pinnedUt: 30_000,
    });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.dock.distance" windowSec={35_000} />
      </fixture.Provider>,
    );

    const dock = (distance: number) => ({
      relativePosition: { x: distance, y: 0, z: 0 },
      relativeVelocity: { x: 0.5, y: 0, z: 0 },
      distance,
    });
    act(() => {
      fixture.transport.emit(
        "time.warp",
        {
          warpRate: 100_000,
          observationQuantumUt: 10_000,
          sampleIntervalUt: 1,
        },
        { validAt: 0 },
      );
      fixture.transport.emit("vessel.dock", dock(100), { validAt: 0 });
      fixture.transport.emit("vessel.dock", dock(100), { validAt: 10_000 });
      fixture.transport.emit("vessel.dock", dock(1100), { validAt: 20_000 });
      fixture.transport.emit("vessel.dock", dock(2100), { validAt: 30_000 });
    });

    await waitFor(() =>
      expect(readProbe()).toBe(
        "t:0,10000,20000,30000|v:100,100,1100,2100|breaks:2,3",
      ),
    );
  });

  /**
   * Nothing models electric charge. Across the tenth-of-a-real-second spans
   * 100,000x leaves, every moved sample stands alone; at 1x, where the span is
   * the one-second resolution every chart has always drawn, the same values
   * stay joined.
   */
  async function chargeAcross(rate: number, quantum: number) {
    const key = "vessel.resources.resources.ElectricCharge.current";
    const charge = (current: number) => ({
      resources: { ElectricCharge: { current, max: 200, active: true } },
    });
    const fixture = buildStreamFixture({
      carriedChannels: ["vessel.resources", "time.warp"],
      pinnedUt: 2 * quantum,
    });
    render(
      <fixture.Provider>
        <Probe dataKey={key} windowSec={3 * quantum} />
      </fixture.Provider>,
    );
    act(() => {
      fixture.transport.emit(
        "time.warp",
        { warpRate: rate, observationQuantumUt: quantum, sampleIntervalUt: 1 },
        { validAt: 0 },
      );
      fixture.transport.emit("vessel.resources", charge(40), { validAt: 0 });
      fixture.transport.emit("vessel.resources", charge(150), {
        validAt: quantum,
      });
      fixture.transport.emit("vessel.resources", charge(60), {
        validAt: 2 * quantum,
      });
    });
  }

  it("breaks a moved value no model claims across a warped span", async () => {
    await chargeAcross(100_000, 10_000);
    await waitFor(() =>
      expect(readProbe()).toBe("t:0,10000,20000|v:40,150,60|breaks:1,2"),
    );
  });

  it("joins the same value at 1x, across the sampling's own resolution", async () => {
    await chargeAcross(1, 1);
    await waitFor(() =>
      expect(readProbe()).toBe("t:0,1,2|v:40,150,60|breaks:"),
    );
  });
});

describe("useDataSeries: bridges", () => {
  /**
   * At 1x a moving distance is carried across every one-second gap, so each
   * chord goes to the chart beside the model's own path for the chart to judge,
   * rather than being broken or passed over.
   */
  it("hands the chart the model's path across each gap it carries", async () => {
    const fixture = buildStreamFixture({
      carriedChannels: ["vessel.dock", "time.warp"],
      pinnedUt: 2,
    });

    render(
      <fixture.Provider>
        <BridgeProbe dataKey="vessel.dock.distance" windowSec={10} />
      </fixture.Provider>,
    );

    const dock = (distance: number) => ({
      relativePosition: { x: distance, y: 0, z: 0 },
      relativeVelocity: { x: 0.5, y: 0, z: 0 },
      distance,
    });
    act(() => {
      fixture.transport.emit(
        "time.warp",
        { warpRate: 1, observationQuantumUt: 1 },
        { validAt: 0 },
      );
      fixture.transport.emit("vessel.dock", dock(100), { validAt: 0 });
      fixture.transport.emit("vessel.dock", dock(100.5), { validAt: 1 });
      fixture.transport.emit("vessel.dock", dock(101), { validAt: 2 });
    });

    await waitFor(() =>
      expect(screen.getByTestId("bridges").textContent).toBe(
        "breaks:|bridges:1/linear-dead-reckoning/24,2/linear-dead-reckoning/24",
      ),
    );
  });
});

describe("useDataSeries: a DERIVED field path streams a REAL series computed from raw stream inputs", () => {
  /**
   * `dv.currentStageResource` joins `dv.stages` to `vessel.structure`.
   * `TimelineStore.sampleRange` still returns `undefined` for a derived
   * topic (by design: nothing is ever stored for one), but
   * `sampleDerivedRange` replays the channel's `derive` at every UT either
   * raw input changed within the window, off `sampleRange` reads of THOSE raw
   * topics' own buffered ranges.
   *
   * The two inputs change at different instants, and a staging event changes
   * the value with no new `dv.stages` sample at all, so a replay that walked
   * only one input's instants would miss a point.
   */
  it("sampleDerivedRange replays derive at every instant either input changed", async () => {
    const fixture = buildStreamFixture({
      carriedChannels: ["dv.stages", "vessel.structure"],
      pinnedUt: 100,
    });

    render(
      <fixture.Provider>
        <Probe dataKey="dv.currentStageResource.LiquidFuel" windowSec={200} />
      </fixture.Provider>,
    );

    expect(readProbe()).toBe("t:|v:|breaks:");
    /* Real subscriptions must have happened for StubTransport (subscription-
       gated) to deliver at all, and the derived channel resolves to its raw
       inputs, so those are what a subscription must land on. */
    expect(fixture.transport.isSubscribed("dv.stages")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.structure")).toBe(true);

    const stages = (upper: number) => [
      { stage: 1, resources: { LiquidFuel: { current: upper, max: 400 } } },
      { stage: 0, resources: { LiquidFuel: { current: 100, max: 100 } } },
    ];
    act(() => {
      fixture.transport.emit(
        "vessel.structure",
        { currentStage: 1 },
        { validAt: 0 },
      );
      fixture.transport.emit("dv.stages", stages(300), { validAt: 10 });
      fixture.transport.emit("dv.stages", stages(200), { validAt: 50 });
      fixture.transport.emit(
        "vessel.structure",
        { currentStage: 0 },
        { validAt: 100 },
      );
    });

    await waitFor(() =>
      expect(readProbe()).toBe("t:10,50,100|v:300,200,100|breaks:"),
    );
  });
});

describe("useDataSeries: what decides whether a window fills", () => {
  it("is empty with no TelemetryProvider in the tree", () => {
    render(<Probe dataKey="vessel.orbit.sma" windowSec={60} />);
    expect(readProbe()).toBe("t:|v:|breaks:");
  });

  it("plots a topic the provider's carried list does not name", async () => {
    const fixture = buildStreamFixture({ carriedChannels: [], pinnedUt: 100 });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.orbit.sma" windowSec={60} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.transport.emit("vessel.orbit", { sma: 679_400 }, { validAt: 60 });
      fixture.transport.emit("vessel.orbit", { sma: 679_800 }, { validAt: 90 });
    });

    await waitFor(() =>
      expect(readProbe()).toBe("t:60,90|v:679400,679800|breaks:"),
    );
  });
});
