import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KERBIN_MU, KERBIN_RADIUS } from "./heroFlightModel";
import {
  buildHeroFrames,
  HERO_FLIGHT_FIXTURE,
  type HeroFrame,
  readHeroFrames,
  serialiseHeroFrames,
} from "./heroFlightWire";

/** A number read from a Topic's payload by field path, which fails the test when the path does not end on one. */
function num(frame: HeroFrame, topic: string, ...path: string[]): number {
  const line = frame.lines.find((l) => l.topic === topic);
  let node: unknown = line?.payload;
  for (const key of path) {
    node =
      typeof node === "object" && node !== null
        ? Object.getOwnPropertyDescriptor(node, key)?.value
        : undefined;
  }
  if (typeof node !== "number")
    throw new Error(
      `${topic}.${path.join(".")} at ${frame.ut} is not a number`,
    );
  return node;
}

/** Every stage's remaining fuel on a frame, in tonnes. */
function stageFuel(frame: HeroFrame): number[] {
  const line = frame.lines.find((l) => l.topic === "dv.stages");
  if (!Array.isArray(line?.payload)) throw new Error("no dv.stages");
  return line.payload.map((_, i) =>
    num(frame, "dv.stages", String(i), "fuelMass"),
  );
}

describe("hero flight fixture", () => {
  const frames = readHeroFrames();

  it("is the model's output, so the two cannot drift", () => {
    expect(readFileSync(HERO_FLIGHT_FIXTURE, "utf8")).toBe(
      serialiseHeroFrames(buildHeroFrames()),
    );
  });

  it("moves forward in time and stamps every line with its frame's instant", () => {
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].ut).toBeGreaterThan(frames[i - 1].ut);
    }
    for (const f of frames) {
      for (const l of f.lines) expect(l.meta.validAt).toBe(f.ut);
    }
  });

  it("keeps speed, altitude and orbit consistent on every frame", () => {
    for (const f of frames) {
      const r = KERBIN_RADIUS + num(f, "vessel.flight", "altitudeAsl");
      const sma = num(f, "vessel.orbit", "sma");
      const speed = num(f, "vessel.flight", "orbitalSpeed");
      const visViva = Math.sqrt(KERBIN_MU * (2 / r - 1 / sma));
      expect(Math.abs(visViva - speed) / visViva).toBeLessThan(0.01);
      expect(Math.abs(num(f, "vessel.flight", "latitude"))).toBeLessThanOrEqual(
        num(f, "vessel.orbit", "inc") + 0.2,
      );
    }
  });

  it("burns fuel and never refills it", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const f of frames) {
      const total = stageFuel(f).reduce((sum, x) => sum + x, 0);
      expect(total).toBeLessThanOrEqual(previous + 1e-6);
      previous = total;
    }
  });

  it("ends in a circular orbit clear of the air", () => {
    const last = frames[frames.length - 1];
    const sma = num(last, "vessel.orbit", "sma");
    const ecc = num(last, "vessel.orbit", "ecc");
    expect(sma * (1 - ecc) - KERBIN_RADIUS).toBeGreaterThan(75_000);
    expect(ecc).toBeLessThan(0.02);
    expect(num(last, "vessel.identity", "situation")).toBe(3);
  });
});
