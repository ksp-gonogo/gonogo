import {
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  Quality,
  type Reading,
  type ReadingSeriesRange,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  createFakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { plotColumnsOf, useSeriesReadings } from "./useSeriesReadings";

/**
 * `useSeriesReadings` hands back the window `useDataSeries` reads with each
 * sample as the reading it was, and `plotColumnsOf` is what a chart draws of
 * one. The window itself is `useDataSeries`'s and is tested there.
 */

let seen: ReadingSeriesRange = { t: [], readings: [] };

function Probe({ windowSec }: { windowSec: number }) {
  seen = useSeriesReadings(
    { topic: "vessel.flight", field: "orbitalSpeed" },
    windowSec,
  );
  return null;
}

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
  horizon: { kind: 1, trajectoryKind: 1 },
};

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

function buildStreamFixture(pinnedUt: number) {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  clock.scrubTo(pinnedUt);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }

  function emitOrbiting(uts: readonly number[]): void {
    transport.emit("system.bodies", KERBIN_SYSTEM, {
      validAt: 0,
      deliveredAt: 0,
      quality: Quality.OnRails,
    });
    for (const ut of uts) {
      transport.emit("vessel.orbit", ECCENTRIC_KERBIN_ORBIT, {
        validAt: ut,
        deliveredAt: ut,
        quality: Quality.OnRails,
      });
      transport.emit(
        "vessel.flight",
        { altitudeAsl: 300_000, orbitalSpeed: 2200, verticalSpeed: 0 },
        { validAt: ut, deliveredAt: ut, quality: Quality.OnRails },
      );
    }
  }

  return { store, Provider, emitOrbiting };
}

describe("useSeriesReadings", () => {
  it("hands back an observed sample as an observed reading at its own instant", async () => {
    const fixture = buildStreamFixture(250);
    render(
      <fixture.Provider>
        <Probe windowSec={900} />
      </fixture.Provider>,
    );
    act(() => fixture.emitOrbiting([0, 100, 200]));

    await waitFor(() => expect(seen.t.length).toBeGreaterThanOrEqual(3));
    const first = seen.readings[0];
    expect(first.state).toBe("observed");
    expect(first.atUt?.toWire()).toBe(seen.t[0]);
    expect(first.reckoning.status).toBe("none");
    await act(async () => {});
  });

  it("hands back an instant nobody measured as the last observation held, with the model's figure beside it", async () => {
    const fixture = buildStreamFixture(600);
    render(
      <fixture.Provider>
        <Probe windowSec={900} />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emitOrbiting([0, 100, 200]);
      // A raw topic's tail fills a SILENCE, so the link has to have dropped.
      fixture.store.setTransportConnected(false);
    });

    await waitFor(() =>
      expect(
        seen.readings.some((r) => r.reckoning.status === "available"),
      ).toBe(true),
    );
    const at = seen.readings.findIndex(
      (r) => r.reckoning.status === "available",
    );
    const modelled = seen.readings[at];
    expect(modelled.state).toBe("held");
    expect(modelled.asOfUt?.toWire()).toBe(200);
    if (modelled.reckoning.status !== "available") throw new Error("no model");
    expect(modelled.reckoning.atUt.toWire()).toBe(seen.t[at]);
    // Everything before the first modelled instant was measured.
    expect(
      seen.readings.slice(0, at).every((r) => r.reckoning.status === "none"),
    ).toBe(true);

    const columns = plotColumnsOf(seen);
    expect(columns.reckoned).toEqual([
      expect.objectContaining({ from: at, to: seen.t.length - 1 }),
    ]);
    await act(async () => {});
  });
});

const NONE = { status: "none" } as const;

function observed(v: unknown, t: number): Reading<unknown> {
  return { state: "observed", value: v, atUt: value("ut", t), reckoning: NONE };
}

function modelled(
  v: number,
  t: number,
  band?: [number, number],
): Reading<unknown> {
  return {
    state: "held",
    value: value("m", 0),
    asOfUt: value("ut", 0),
    grade: "held",
    reckoning: {
      status: "available",
      modelled: value("m", v),
      atUt: value("ut", t),
      beyondReceived: true,
      basis: "kepler-propagation",
      band: band && {
        value: value("m", v),
        lo: value("m", band[0]),
        hi: value("m", band[1]),
        kind: "bound",
      },
    },
  };
}

function series(
  readings: Reading<unknown>[],
  extra: Partial<ReadingSeriesRange> = {},
): ReadingSeriesRange {
  return { t: readings.map((_, i) => i), readings, ...extra };
}

describe("plotColumnsOf", () => {
  it("plots a quantity at its magnitude and a modelled instant at the model's figure", () => {
    const out = plotColumnsOf(
      series([observed(value("m", 5), 0), modelled(7, 1)]),
    );
    expect(out.v).toEqual([5, 7]);
    expect(out.reckoned).toEqual([
      { from: 1, to: 1, basis: "kepler-propagation" },
    ]);
  });

  it("carries a model's band on its run, one entry per instant", () => {
    const out = plotColumnsOf(
      series([observed(1, 0), modelled(2, 1, [1, 3]), modelled(3, 2, [1, 5])]),
    );
    expect(out.reckoned).toEqual([
      {
        from: 1,
        to: 2,
        basis: "kepler-propagation",
        bandLo: [1, 1],
        bandHi: [3, 5],
        bandKind: "bound",
      },
    ]);
  });

  it("names a run that arrived late and draws it from its own value", () => {
    const late: Reading<unknown> = {
      state: "held",
      value: 4,
      asOfUt: value("ut", 1),
      grade: "recorded",
      reckoning: NONE,
    };
    const out = plotColumnsOf(series([observed(1, 0), late, observed(3, 2)]));
    expect(out.v).toEqual([1, 4, 3]);
    expect(out.spans).toEqual([{ from: 1, to: 1, status: "recorded" }]);
    expect(out.reckoned).toEqual([]);
  });

  it("drops a sample with no number and moves its break to the next survivor", () => {
    const out = plotColumnsOf(
      series([observed(1, 0), observed("x", 1), observed(3, 2)], {
        breaks: [1],
      }),
    );
    expect(out.v).toEqual([1, 3]);
    expect(out.breaks).toEqual([1]);
  });

  it("keeps a bridge only where both of its samples survive side by side", () => {
    const bridge = {
      to: 2,
      t: [1.5],
      v: [9],
      basis: "kepler-propagation" as const,
    };
    const kept = plotColumnsOf(
      series([observed(1, 0), observed(2, 1), observed(3, 2)], {
        bridges: [bridge],
      }),
    );
    expect(kept.bridges).toEqual([bridge]);
    const lost = plotColumnsOf(
      series([observed(1, 0), observed("x", 1), observed(3, 2)], {
        bridges: [bridge],
      }),
    );
    expect(lost.bridges).toEqual([]);
  });
});
