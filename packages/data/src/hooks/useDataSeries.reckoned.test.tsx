import { clearRegistry } from "@ksp-gonogo/core";
import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
  vesselStateChannel,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
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
    <div data-testid="window-end">windowEnd:{range.windowEndAt ?? "none"}</div>
  );
}

function readWindowEnd(): string {
  return screen.getByTestId("window-end").textContent ?? "";
}

function readProbe(): string {
  return screen.getByTestId("range").textContent ?? "";
}

const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

/**
 * A closed conic around Kerbin, eccentric so the modelled speed genuinely moves
 * across the tail rather than holding flat.
 */
const ECCENTRIC_KERBIN_ORBIT = {
  referenceBodyIndex: 1,
  sma: 900_000,
  ecc: 0.4,
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
  store.registerDerivedChannel(vesselStateChannel);
  clock.scrubTo(opts.pinnedUt);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={VESSEL_STATE_INPUTS}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return { transport, client, store, Provider };
}

beforeEach(() => clearRegistry());

describe("useDataSeries: the stretch nobody measured", () => {
  it("names a run of modelled points past the last observation", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.state.orbitalSpeed" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      for (const validAt of [0, 100, 200]) {
        fixture.transport.emit("vessel.orbit", ECCENTRIC_KERBIN_ORBIT, {
          validAt,
          quality: Quality.OnRails,
        });
      }
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
        <Probe dataKey="vessel.state.altitudeAsl" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      /*
       * `Quality.Loaded` is the measured basis: altitude comes off
       * `vessel.flight` by interpolation between real samples, and once contact
       * stops there is nothing left to interpolate.
       * `deriveVesselStateReckoning` declines, so the trace honestly stops
       * where the data does.
       */
      fixture.transport.emit(
        "vessel.orbit",
        { referenceBodyIndex: 1 },
        { validAt: 0, quality: Quality.Loaded },
      );
      for (const [validAt, altitudeAsl] of [
        [100, 1000],
        [200, 2000],
      ]) {
        fixture.transport.emit(
          "vessel.flight",
          {
            altitudeAsl,
            verticalSpeed: 0,
            surfaceSpeed: 0,
            orbitalSpeed: 0,
          },
          { validAt },
        );
      }
    });

    await waitFor(() => {
      /*
       * Two points, not three: the orbit sample at UT 0 changes an input, but
       * the record is not whole until a flight sample exists, so `derive`
       * declines there exactly as it does live.
       */
      expect(readProbe()).toBe("n:2|reckoned:");
    });
  });

  it("draws no run for a field the model carries rather than moves", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.state.twr" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      for (const validAt of [0, 100, 200]) {
        fixture.transport.emit("vessel.orbit", ECCENTRIC_KERBIN_ORBIT, {
          validAt,
          quality: Quality.OnRails,
        });
        fixture.transport.emit(
          "vessel.propulsion",
          { availableThrust: 200_000, totalMass: 10_000 },
          { validAt },
        );
      }
    });

    await waitFor(() => {
      /*
       * The record is forward-modelled and TWR is not part of what the conic
       * moves: it comes off the newest `vessel.propulsion` sample and would
       * carry forward as a flat line stamped `kepler-propagation`, which
       * attributes a number to a model that never touched it.
       */
      expect(readProbe()).toBe("n:3|reckoned:");
    });
  });

  it("stops the run where the conic ends, not where the window does", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <Probe dataKey="vessel.state.orbitalSpeed" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      for (const validAt of [0, 100, 200]) {
        fixture.transport.emit(
          "vessel.orbit",
          {
            ...ECCENTRIC_KERBIN_ORBIT,
            // The wire's own next SOI transition. These elements describe the
            // patch the craft is in and stop being about the craft at all once
            // it leaves, so the model withdraws there rather than at a cutoff
            // somebody chose.
            encounter: { transitionType: 1, transitionUt: 420, bodyIndex: 2 },
          },
          { validAt, quality: Quality.OnRails },
        );
      }
    });

    await waitFor(() => {
      // The stride is 100, so the walk offers 300, 400 and then 500, which is
      // past the transition. Two modelled points, not four.
      expect(readProbe()).toMatch(/^n:5\|reckoned:3-4:kepler-propagation$/);
    });
  });
});

describe("useDataSeries: how far the window was asked for", () => {
  it("states the view time alongside a tail, so a decline is measurable", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <WindowEndProbe dataKey="vessel.state.orbitalSpeed" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      for (const ut of [0, 40, 80]) {
        fixture.transport.emit("vessel.orbit", ECCENTRIC_KERBIN_ORBIT, {
          validAt: ut,
          deliveredAt: ut,
          quality: Quality.OnRails,
        });
      }
    });

    /*
     * Without this the axis is the extent of the data, so a model that
     * withdrew at its horizon draws exactly like one that ran to the edge: the
     * series shortens, the axis shrinks with it, and the blank that IS the
     * statement is cropped away.
     */
    await waitFor(() => expect(readWindowEnd()).toBe("windowEnd:600"));
  });

  it("states nothing where no model answered, so a live chart's axis is untouched", async () => {
    const fixture = buildStreamFixture({ pinnedUt: 600 });

    render(
      <fixture.Provider>
        <WindowEndProbe dataKey="vessel.state.altitudeAsl" windowSec={900} />
      </fixture.Provider>,
    );

    act(() => {
      fixture.transport.emit(
        "vessel.flight",
        { altitudeAsl: 1000 },
        {
          validAt: 100,
          deliveredAt: 100,
          quality: Quality.Loaded,
        },
      );
      fixture.transport.emit("vessel.orbit", ECCENTRIC_KERBIN_ORBIT, {
        validAt: 100,
        deliveredAt: 100,
        quality: Quality.Loaded,
      });
    });

    /*
     * A measured series has made no claim about the stretch after its last
     * sample, and stating the view time there would put a moving number in
     * every live chart's snapshot for an emptiness that means nothing.
     */
    await waitFor(() => expect(readWindowEnd()).toBe("windowEnd:none"));
  });
});
