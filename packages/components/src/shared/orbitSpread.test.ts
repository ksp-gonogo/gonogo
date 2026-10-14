import {
  TimelineStore,
  type TopicReading,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { Quality, value } from "@ksp-gonogo/sitrep-sdk";
import { makeMeta } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { orbitSpread } from "./orbitSpread";

const MU = 3.5316e12;
const SMA = 1_200_000;
const PERIOD = 2 * Math.PI * Math.sqrt(SMA ** 3 / MU);
const LIGHT_TIME = 10;

function orbit(departure: unknown, ecc = 0.3) {
  return {
    referenceBodyIndex: 1,
    sma: value("m", SMA),
    ecc: value("1", ecc),
    inc: value("°", 0),
    lan: value("°", 0),
    argPe: value("°", 0),
    meanAnomalyAtEpoch: value("rad", 0.4),
    epoch: value("ut", 0),
    mu: value("m³/s²", MU),
    horizon: {
      kind: 2,
      trajectoryKind: 2,
      untilUt: value("ut", PERIOD),
      departure,
    },
  };
}

function knot(metres: number) {
  return [
    {
      untilUt: value("ut", PERIOD),
      metres: value("m", metres),
      metresPerSecond: value("m/s", 0.01),
    },
  ];
}

/** The store's reading of `vessel.orbit` at `viewAfter` seconds past the one sample, off a real orbit reckoner. */
function readingAt(
  departure: unknown,
  viewAfter: number,
  ecc?: number,
): TopicReading<ReturnType<typeof orbit>> {
  let wall = LIGHT_TIME;
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => wall,
      warpRate: () => 1,
      delaySeconds: () => LIGHT_TIME,
    }),
  );
  store.setTransportConnected(false);
  const at = (payload: unknown) => ({
    validAt: 0,
    payload,
    meta: makeMeta({
      validAt: 0,
      deliveredAt: LIGHT_TIME,
      quality: Quality.OnRails,
      source: "vessel:probe",
    }),
    epoch: 0,
  });
  store.ingest(
    "trackingStation.bodies",
    at({ bodies: [{ index: 1, radius: value("m", 600_000) }] }) as never,
  );
  store.ingest("vessel.orbit", at(orbit(departure, ecc)) as never);
  wall = viewAfter;
  store.beginFrame();
  return store.sampleReading("vessel.orbit");
}

function observedOf(reading: ReturnType<typeof readingAt>) {
  if (reading.state !== "observed" && reading.state !== "held") {
    throw new Error("the sample was never observed");
  }
  return reading.value;
}

describe("orbitSpread", () => {
  it("runs along the orbit about the modelled place, as wide as the stated drift", () => {
    const reading = readingAt(knot(55_000), 1000, 0);
    const spread = orbitSpread(reading, observedOf(reading));

    if (spread === undefined) throw new Error("expected a spread");
    // A circular orbit: 55 km along-track at radius a is 55000 / 1.2e6 rad.
    expect(spread.halfWidth.in("°").magnitude).toBeCloseTo(
      ((55_000 / SMA) * 180) / Math.PI,
      6,
    );
    const first = spread.anomalies[0];
    const last = spread.anomalies[spread.anomalies.length - 1];
    expect(first).toBeLessThan(last);
  });

  it("widens by the along-track conversion on an eccentric orbit", () => {
    const circular = readingAt(knot(55_000), 1000, 0);
    const eccentric = readingAt(knot(55_000), 1000, 0.3);
    const a = orbitSpread(circular, observedOf(circular));
    const b = orbitSpread(eccentric, observedOf(eccentric));

    expect(b?.halfWidth.in("°").magnitude).not.toBeCloseTo(
      a?.halfWidth.in("°").magnitude ?? 0,
      3,
    );
  });

  it("is the whole orbit when the band is wider than one turn", () => {
    const reading = readingAt(knot(8_000_000), 1000, 0);
    const spread = orbitSpread(reading, observedOf(reading));

    expect(spread?.halfWidth.in("°").magnitude).toBe(180);
  });

  it("offers nothing when the provider stated no departure", () => {
    const reading = readingAt(null, 1000);
    expect(orbitSpread(reading, observedOf(reading))).toBeUndefined();
  });

  it("offers nothing past the horizon, where the orbit is refused", () => {
    const reading = readingAt(knot(55_000), PERIOD + 400);
    expect(orbitSpread(reading, observedOf(reading))).toBeUndefined();
  });

  it("offers nothing without observed elements", () => {
    const reading = readingAt(knot(55_000), 1000);
    expect(orbitSpread(reading, undefined)).toBeUndefined();
  });
});
