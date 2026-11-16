import { PerfBudget, useTelemetry } from "@ksp-gonogo/core";
import { predictImpactPoint, wrap180 } from "@ksp-gonogo/sitrep-client";
import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import descending from "./__fixtures__/kerbin-reentry.json";
import { useMapTelemetry } from "./useMapTelemetry";

const taken = descending._stream.pinnedUt ?? 100;
const KERBIN_RADIUS = 600_000;

/**
 * A craft falling to Kerbin's surface from 28 km on a 500 km by 0.3 conic that
 * dips 250 km under it: the elements place it at that height, falling, and the
 * walk finds the point it lands on.
 */
const patch = {
  sma: 500_000,
  ecc: 0.3,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 3.846453003974741,
  epoch: taken,
  period: 1182.086,
  startUt: taken,
  endUt: taken + 1182.086,
  patchStartTransition: 0,
  patchEndTransition: 5,
  peA: -250_000,
  apA: 50_000,
  semiLatusRectum: 455_000,
  semiMinorAxis: 476_970,
  referenceBody: "Kerbin",
  referenceBodyIndex: 1,
  mu: 3_531_600_000_000,
};

const scene = descending._stream.emits.map((emit) => {
  if (emit.channel === "vessel.orbit") {
    return {
      ...emit,
      value: { ...(emit.value as object), ...patch, patches: [patch] },
    };
  }
  if (emit.channel === "vessel.flight") {
    return {
      ...emit,
      value: { ...(emit.value as object), latitude: 0, verticalSpeed: -330.96 },
    };
  }
  return emit;
});

interface Captured {
  orbit?: Parameters<typeof predictImpactPoint>[0]["orbit"];
  flight?: Parameters<typeof predictImpactPoint>[0]["flight"];
  bodies?: Parameters<typeof predictImpactPoint>[0]["bodies"];
  marker?: { lat: number | undefined; lon: number | undefined };
}
const captured: Captured = {};

function Probe() {
  const map = useMapTelemetry(undefined);
  const orbit = useTelemetry("vessel.orbit");
  const flight = useTelemetry("vessel.flight");
  const bodies = useTelemetry("trackingStation.bodies");
  captured.marker = { lat: map.impactLat, lon: map.impactLon };
  captured.orbit = orbit.state === "observed" ? orbit.value : undefined;
  captured.flight = flight.state === "observed" ? flight.value : undefined;
  captured.bodies = bodies.state === "observed" ? bodies.value : undefined;
  return null;
}

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: taken, suspendFrames: true });
  for (const emit of scene) fixture.client.subscribe(emit.channel, () => {});
  render(
    <fixture.Provider>
      <Probe />
    </fixture.Provider>,
  );
  act(() => {
    for (const emit of scene) {
      fixture.emit(emit.channel, emit.value, {
        validAt: taken,
        deliveredAt: taken,
      });
    }
  });
  return fixture;
}

function impactBudget(): PerfBudget {
  const budget = PerfBudget.getAll().find((b) =>
    b.name.startsWith("predictImpactPoint"),
  );
  if (!budget)
    throw new Error("the predictImpactPoint budget is not registered");
  return budget;
}

/** Metres on the surface between two points on the equatorial belt the scene flies over. */
function metresApart(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const perDegree = (Math.PI * KERBIN_RADIUS) / 180;
  return Math.hypot(
    (a.lat - b.lat) * perDegree,
    wrap180(a.lon - b.lon) * perDegree * Math.cos((a.lat * Math.PI) / 180),
  );
}

describe("GroundTrack's impact prediction", () => {
  it("is not made again on every frame the view clock moves", () => {
    const budget = impactBudget();
    const fixture = mount();
    // The scene is observed, so the prediction was asked for at least once.
    expect(budget.windowTotal()).toBeGreaterThan(0);
    budget.reset();
    for (let i = 1; i <= 60; i++) {
      act(() => {
        fixture.wall.advanceBy(1 / 60);
        fixture.scrubTo(taken + i / 60);
      });
    }
    expect(budget.windowTotal()).toBeLessThanOrEqual(2);
  });

  it("is made at most five times a second at 100x warp", () => {
    const budget = impactBudget();
    const fixture = mount();
    budget.reset();
    for (let i = 1; i <= 60; i++) {
      act(() => {
        fixture.wall.advanceBy(1 / 60);
        fixture.scrubTo(taken + (i / 60) * 100);
      });
    }
    expect(budget.windowTotal()).toBeLessThanOrEqual(6);
  });

  it("glides with the body's turning between predictions, within 10 m of a prediction made on every frame", () => {
    const fixture = mount();
    expect(captured.marker?.lat).toBeDefined();
    let worst = 0;
    for (let i = 1; i <= 60; i++) {
      act(() => {
        fixture.wall.advanceBy(1 / 60);
        fixture.scrubTo(taken + i / 60);
      });
      const everyFrame = predictImpactPoint({
        orbit: captured.orbit as never,
        flight: captured.flight as never,
        bodies: captured.bodies,
        viewUt: taken + i / 60,
      });
      expect(everyFrame).not.toBeNull();
      const marker = captured.marker;
      if (!everyFrame || marker?.lat === undefined || marker.lon === undefined)
        throw new Error("no marker");
      worst = Math.max(
        worst,
        metresApart(everyFrame, { lat: marker.lat, lon: marker.lon }),
      );
    }
    // Held without the carry the same second is about 180 m out at its end.
    expect(worst).toBeLessThan(10);
  });
});
