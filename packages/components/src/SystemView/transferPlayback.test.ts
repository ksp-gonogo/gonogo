import { describe, expect, it } from "vitest";
import {
  ENCOUNTER_UT,
  hohmann,
  KERBIN_MU,
  MUN_ORBIT_RADIUS,
  orbitAt,
  PARKING_RADIUS,
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

  it("ends the coast inside the half period, where the encounter begins", () => {
    const h = hohmann(KERBIN_MU, PARKING_RADIUS, MUN_ORBIT_RADIUS);
    expect(ENCOUNTER_UT).toBeLessThan(h.halfPeriod);
    expect(transferFrames().at(-1)?.ut).toBe(ENCOUNTER_UT);
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
