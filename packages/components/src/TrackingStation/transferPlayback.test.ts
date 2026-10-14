import { describe, expect, it } from "vitest";
import {
  CAPTURE_RATE,
  CAPTURE_SPAN,
  captureOrbitAt,
  ENCOUNTER_UT,
  hohmann,
  KERBIN_MU,
  MUN_ORBIT_RADIUS,
  orbitAt,
  PARKING_RADIUS,
  TILTED_CATALOGUE,
  TRANSFER_RATE,
  transferFrames,
} from "../../scripts/systemTransferModel";
import fixture from "./__fixtures__/kerbin-mun-encounter.json";

const orbit = fixture._stream.emits.find((e) => e.channel === "vessel.orbit")
  ?.value as { sma: number; ecc: number };

describe("Mun transfer playback", () => {
  it("rides the Hohmann ellipse the fixture's craft is on", () => {
    const h = hohmann(KERBIN_MU, PARKING_RADIUS, MUN_ORBIT_RADIUS);
    expect(h.sma).toBeCloseTo(orbit.sma, -2);
    expect(h.ecc).toBeCloseTo(orbit.ecc, 5);
  });

  it("ends the coast inside the half period, where the craft meets the Mun's sphere of influence", () => {
    const h = hohmann(KERBIN_MU, PARKING_RADIUS, MUN_ORBIT_RADIUS);
    expect(ENCOUNTER_UT).toBeLessThan(h.halfPeriod);
    expect(orbitAt(0)).toMatchObject({
      encounter: { transitionUt: ENCOUNTER_UT },
      patches: [{ endUt: ENCOUNTER_UT }],
    });
  });

  it("goes on past the encounter in orbit about the Mun, for half a revolution", () => {
    const frames = transferFrames();
    expect(frames.at(-1)?.ut).toBeCloseTo(ENCOUNTER_UT + CAPTURE_SPAN, 3);
    const after = frames.filter((f) => f.ut > ENCOUNTER_UT);
    expect(after.length).toBeGreaterThan(50);
    const step = after[2].ut - after[1].ut;
    expect(step).toBeCloseTo(0.1 * CAPTURE_RATE, 6);
  });

  it("plays 30 to 60 seconds, moving the clock forward every frame", () => {
    const frames = transferFrames();
    const seconds = frames.at(-1)?.seconds ?? 0;
    expect(seconds).toBeGreaterThanOrEqual(30);
    expect(seconds).toBeLessThanOrEqual(60);
    expect(frames[1].ut).toBeCloseTo(0.1 * TRANSFER_RATE, 6);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].ut).toBeGreaterThan(frames[i - 1].ut);
    }
  });
});

describe("Mun transfer playback samples", () => {
  it("restart the conic at each instant, so the craft's anomaly is where the ellipse puts it", () => {
    const h = hohmann(KERBIN_MU, PARKING_RADIUS, MUN_ORBIT_RADIUS);
    const meanMotion = Math.sqrt(KERBIN_MU / h.sma ** 3);
    const sent = orbitAt(ENCOUNTER_UT);
    expect(sent.epoch).toBe(ENCOUNTER_UT);
    expect(sent.meanAnomalyAtEpoch).toBeCloseTo(
      (meanMotion * ENCOUNTER_UT) % (2 * Math.PI),
      9,
    );
  });
});

describe("Mun transfer playback capture", () => {
  const MUN_INDEX = 2;
  const emitted = (
    emits: { channel: string; value: unknown }[],
    channel: string,
  ) => emits.find((e) => e.channel === channel)?.value;

  it("keeps the craft about Kerbin until the encounter and about the Mun from it", () => {
    for (const frame of transferFrames()) {
      const body = frame.ut >= ENCOUNTER_UT ? MUN_INDEX : 1;
      expect(emitted(frame.emits, "vessel.identity")).toMatchObject({
        parentBodyIndex: body,
      });
      expect(emitted(frame.emits, "vessel.orbit")).toMatchObject({
        referenceBodyIndex: body,
      });
    }
  });

  it("binds the craft to the Mun on an ellipse that stays inside its sphere of influence", () => {
    const { sma, ecc, mu } = captureOrbitAt(ENCOUNTER_UT);
    expect(ecc).toBeGreaterThan(0);
    expect(ecc).toBeLessThan(1);
    expect(sma * (1 + ecc)).toBeLessThanOrEqual(2_429_559 + 1e-6);
    expect(sma * (1 - ecc)).toBeGreaterThan(200_000);
    expect(mu).toBeCloseTo(6.5138398e10, -3);
  });

  it("starts the capture orbit at apoapsis and ends it at periapsis", () => {
    const at = (ut: number) =>
      captureOrbitAt(ut).meanAnomalyAtEpoch % (2 * Math.PI);
    expect(at(ENCOUNTER_UT)).toBeCloseTo(Math.PI, 9);
    expect(at(ENCOUNTER_UT + CAPTURE_SPAN)).toBeCloseTo(0, 6);
  });
});

describe("Mun transfer playback keyframes", () => {
  it("restates the catalogue on every frame, so no body figure goes held as the clock runs", () => {
    for (const frame of transferFrames()) {
      const bodies = frame.emits.find(
        (e) => e.channel === "trackingStation.bodies",
      );
      expect(bodies?.meta?.deliveredAt).toBe(frame.ut);
    }
  });

  it("tilts Minmus only, as the stock system does", () => {
    const orbitOf = (name: string) =>
      TILTED_CATALOGUE.bodies.find((b) => b.name === name)?.orbit;
    expect(orbitOf("Minmus")?.inc).toBe(6);
    expect(orbitOf("Mun")?.inc).toBe(0);
  });
});
