import { clearRegistry } from "@ksp-gonogo/core";
import {
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import {
  createFakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDataSeries } from "./useDataSeries";

/**
 * The reckoned half of a series: what `useDataSeries` says about the stretch
 * after the last observation.
 *
 * Every other producer in this hook reads samples somebody sent. This one asks
 * the topic's own forward model, so the assertions are about a run of points
 * with no observation behind them, named as such: `reckoned`, indices into the
 * same `t`/`v` the measured half fills, carrying the model that answered.
 *
 * The mechanism itself is isolated in `@ksp-gonogo/sitrep-client`'s
 * `timeline-store-reckoned-tail.test.ts`; this file is about the join.
 */

function Probe({ dataKey, windowSec }: { dataKey: string; windowSec: number }) {
  const range = useDataSeries("data", dataKey, windowSec);
  return (
    <div data-testid="range">
      n:{range.t.length}|reckoned:
      {(range.reckoned ?? [])
        .map((r) => `${r.from}-${r.to}:${r.basis}`)
        .join(",")}
    </div>
  );
}

function WindowEndProbe({
  dataKey,
  windowSec,
}: {
  dataKey: string;
  windowSec: number;
}) {
  const range = useDataSeries("data", dataKey, windowSec);
  return (
    <div data-testid="window-end">
      n:{range.t.length}|windowEnd:{range.windowEndAt ?? "none"}
    </div>
  );
}

function readWindowEnd(): string {
  return screen.getByTestId("window-end").textContent ?? "";
}

function readProbe(): string {
  return screen.getByTestId("range").textContent ?? "";
}

/**
 * The tail's VALUES rather than its runs: what a chart axis is actually handed
 * where the modelled quantity arrived wrapped.
 */
function ValueProbe({
  dataKey,
  windowSec,
}: {
  dataKey: string;
  windowSec: number;
}) {
  const range = useDataSeries("data", dataKey, windowSec);
  const last = range.v[range.v.length - 1];
  return (
    <div data-testid="values">
      n:{range.t.length}|runs:{(range.reckoned ?? []).length}|last:
      {typeof last}
    </div>
  );
}

function readValues(): string {
  return screen.getByTestId("values").textContent ?? "";
}

/** What the probes plot, and what `vessel.flight`'s reckoner reads. */
const CARRIED = [
  "vessel.flight",
  "vessel.orbit",
  "system.bodies",
  "vessel.target",
];

/**
 * A closed conic around Kerbin, eccentric so the modelled speed genuinely moves
 * across the tail rather than holding flat, with its periapsis 240 km up so no
 * instant of it is inside the atmosphere, where the conic withdraws.
 */
const ECCENTRIC_KERBIN_ORBIT = {
  referenceBodyIndex: 1,
  sma: 1_200_000,
  ecc: 0.3,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3_531_600_000_000,
  /*
   * What the stock producer sends, reach AND shape (`AnalyticHorizon()` in
   * `VesselViewProvider.cs`). Not nullable on the wire, so an element set
   * without it is a recording of a producer that dropped a required field
   * rather than a neutral scene. The JSON gate beside it
   * (`orbitFixtureHorizon`) cannot see an inline one, and this is the
   * constant the next reckoning test gets copied from.
   */
  horizon: { kind: 1, trajectoryKind: 1 },
};

/**
 * Kerbin alone, which is all `vessel.flight`'s reckoner reads of the system:
 * the reference body's radius for sea level, and the published atmosphere depth
 * the handover selector compares an observed altitude against.
 */
const KERBIN_SYSTEM = {
  bodies: [
    {
      name: "Kerbin",
      index: 1,
      parentIndex: 0,
      radius: 600_000,
      orbit: null,
      atmosphere: { depth: 70_000 },
    },
  ],
};

function buildStreamFixture(opts: { pinnedUt: number }) {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  clock.scrubTo(opts.pinnedUt);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={CARRIED}
      >
        {children}
      </TelemetryProvider>
    );
  }

  /**
   * Kerbin, then a craft on rails 300 km up at each of `uts`, with the orbit
   * and flight sampled together. Above the atmosphere, so the flight reckoner
   * takes its conic branch rather than the descent one.
   */
  function emitOrbiting(
    uts: readonly number[],
    orbit: Record<string, unknown> = ECCENTRIC_KERBIN_ORBIT,
    quality: Quality = Quality.OnRails,
  ): void {
    transport.emit("system.bodies", KERBIN_SYSTEM, {
      validAt: 0,
      deliveredAt: 0,
      quality: Quality.OnRails,
    });
    for (const ut of uts) {
      transport.emit("vessel.orbit", orbit, {
        validAt: ut,
        deliveredAt: ut,
        quality,
      });
      transport.emit(
        "vessel.flight",
        { altitudeAsl: 300_000, orbitalSpeed: 2200, verticalSpeed: 0 },
        { validAt: ut, deliveredAt: ut, quality },
      );
    }
  }

  return { transport, client, store, Provider, emitOrbiting };
}

beforeEach(() => clearRegistry());

describe("useDataSeries: the stretch nobody measured", () => {
  it("names a run of modelled points past the last observation", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.flight.orbitalSpeed" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emitOrbiting([0, 100, 200]);
      // A raw topic's tail fills a SILENCE, so the link has to have dropped.
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() => {
      // Three observations, then a run of modelled points reaching the view
      // time. The run starts where the observations stop.
      expect(readProbe()).toMatch(/^n:7\|reckoned:3-6:kepler-propagation$/);
    });
  });

  it("says nothing about a measured basis, where no model is offered", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.flight.altitudeAsl" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      /*
       * `Quality.Loaded` is the craft under physics, where the conic ignores
       * whatever the physics is doing, so the flight reckoner declines and the
       * trace honestly stops where the data does, across a silence as much as
       * while the link is up.
       */
      fixture.emitOrbiting([100, 200], ECCENTRIC_KERBIN_ORBIT, Quality.Loaded);
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() => {
      expect(readProbe()).toBe("n:2|reckoned:");
    });
  });

  it("draws no run once the view time is past where the conic ends", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.flight.orbitalSpeed" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emitOrbiting([0, 100, 200], {
        ...ECCENTRIC_KERBIN_ORBIT,
        // The wire's own next SOI transition. These elements describe the
        // patch the craft is in and stop being about the craft at all once it
        // leaves, so the model withdraws there rather than at a cutoff
        // somebody chose. `vessel.flight`'s conic is bound by `vessel.orbit`'s
        // horizon at the read's view time, so a view past the transition gets
        // no tail rather than one clipped short.
        encounter: { transitionType: 1, transitionUt: 420, bodyIndex: 2 },
      });
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() => {
      // The three observations and nothing modelled after them, where the
      // same elements without the transition draw a run to the view time.
      expect(readProbe()).toBe("n:3|reckoned:");
    });
  });
});

describe("useDataSeries: a modelled quantity that arrived with a unit", () => {
  it("plots the tail of a Value-typed topic, magnitudes and all", async () => {
    /*
     * `vessel.flight.altitudeAsl` arrives wrapped, and it is what the
     * atmosphere-handover render set draws: a point read described a carried
     * altitude in words while a plot of it stopped at the last packet.
     *
     * The assertion is a `typeof`, not a figure. What the arithmetic says is
     * pinned next to the model in `@ksp-gonogo/sitrep-client`; what matters
     * here is that the wrapper is taken off exactly once, at this boundary, so
     * a chart axis is handed a number and not an object it would silently
     * scale to nothing.
     */
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <ValueProbe dataKey="vessel.flight.altitudeAsl" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.transport.emit("system.bodies", KERBIN_SYSTEM, {
        validAt: 0,
        deliveredAt: 0,
        quality: Quality.OnRails,
      });
      for (const ut of [0, 100, 200]) {
        fixture.transport.emit("vessel.orbit", ECCENTRIC_KERBIN_ORBIT, {
          validAt: ut,
          deliveredAt: ut,
          quality: Quality.OnRails,
        });
        fixture.transport.emit(
          "vessel.flight",
          { altitudeAsl: 300_000, orbitalSpeed: 2200, verticalSpeed: 0 },
          { validAt: ut, deliveredAt: ut, quality: Quality.OnRails },
        );
      }
      /*
       * A RAW topic's tail fills a SILENCE, so the walk withdraws outright
       * while the link is up: there is no gap for a model to have carried
       * anything across.
       */
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() => {
      expect(readValues()).toMatch(/^n:[1-9]\d*\|runs:[1-9]\d*\|last:number$/);
    });
  });
});

describe("useDataSeries: the inputs the model was promised", () => {
  /**
   * A plot of a RAW topic holds up its elected reckoner's declared deps for as
   * long as it is mounted.
   *
   * The plotted topic and a derived channel's inputs were the whole of what a
   * series read subscribed, and a raw topic's reckoner deps are neither, so a
   * lone widget plotting `vessel.flight.altitudeAsl` on an otherwise empty
   * screen declined with `input-absent` and drew no tail. It worked only where
   * some other widget happened to be holding `vessel.orbit` and `system.bodies`
   * up, which is a fact about the rest of the dashboard.
   */
  it("subscribes the deps of the elected reckoner for a lone plot", () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <ValueProbe dataKey="vessel.flight.altitudeAsl" windowSec={900} />
      </fixture.Provider>,
    );

    // The plotted topic is a field of `vessel.flight`, so the deps come off the
    // PARENT record's model, the same ladder `rawReckonedWalk` walks.
    expect(fixture.transport.isSubscribed("vessel.flight")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(true);
  });

  it("releases them again when the plot unmounts", () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    const { unmount } = render(
      <fixture.Provider>
        <ValueProbe dataKey="vessel.flight.altitudeAsl" windowSec={900} />
      </fixture.Provider>,
    );
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    act(() => unmount());

    // A subscription taken for the life of a read and never given back is a
    // leak nothing else in the tree would ever count.
    expect(fixture.transport.isSubscribed("vessel.flight")).toBe(false);
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(false);
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(false);
  });

  it("subscribes nothing extra where the model declares no deps", () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.target" windowSec={900} />
      </fixture.Provider>,
    );

    // Both core dead-reckoning models declare `deps: []`, and an empty
    // declaration has to leave the subscription set exactly as it was.
    expect(fixture.transport.isSubscribed("vessel.target")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(false);
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(false);
  });
});

describe("useDataSeries: how far the window was asked for", () => {
  it("states the view time alongside a tail, so a decline is measurable", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <WindowEndProbe dataKey="vessel.flight.orbitalSpeed" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emitOrbiting([0, 40, 80]);
      fixture.store.setTransportConnected(false);
    });

    /*
     * Without this the axis is the extent of the data, so a model that
     * withdrew at its horizon draws exactly like one that ran to the edge: the
     * series shortens, the axis shrinks with it, and the blank that IS the
     * statement is cropped away.
     */
    await waitFor(() => expect(readWindowEnd()).toMatch(/\|windowEnd:600$/));
  });

  it("states nothing where no model answered, so a live chart's axis is untouched", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <WindowEndProbe dataKey="vessel.flight.altitudeAsl" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emitOrbiting([0, 40, 80], ECCENTRIC_KERBIN_ORBIT, Quality.Loaded);
      fixture.store.setTransportConnected(false);
    });

    /*
     * A measured series has made no claim about the stretch after its last
     * sample, and stating the view time there would put a moving number in
     * every live chart's snapshot for an emptiness that means nothing.
     */
    await waitFor(() => expect(readWindowEnd()).toBe("n:3|windowEnd:none"));
  });
});
