import { afterEach, describe, expect, it } from "vitest";
import { clearBodies, getAllBodies, getBody } from "./bodies";
import { pressureAtAltitude, surfaceGravity } from "./orbital";
import { registerRSSBodies } from "./rss-bodies";
import { registerStockBodies } from "./stock-bodies";

afterEach(() => clearBodies());

// Semi-major axes from the RSS configs, needed to check the SOI KSP computes
// (a·(m/M)^0.4) against the values baked into the registry.
// Rounded to the nearest metre from the RSS configs; a sub-metre trim of a
// ~1e11 m axis is far inside the 0.1 % SOI tolerance asserted below.
const SMA = {
  Earth: 149598261150,
  Moon: 384308438,
  Mars: 227949699962,
  Venus: 108209548790,
} as const;

const G0 = 9.80665;

describe("registerRSSBodies", () => {
  it("registers the five RSS bodies under their runtime (cbNameLater) ids", () => {
    registerRSSBodies();
    const ids = new Set(getAllBodies().map((b) => b.id));
    for (const id of ["Sun", "Earth", "Moon", "Mars", "Venus"]) {
      expect(ids.has(id), `${id} not registered`).toBe(true);
    }
  });

  it("registers Earth with the real radius and GM", () => {
    registerRSSBodies();
    const earth = getBody("Earth");
    expect(earth?.radius).toBe(6_371_000);
    expect(earth?.gm).toBeCloseTo(3.98600435e14, -6);
    expect(earth?.parent).toBe("Sun");
  });

  it("registers Moon as a child of Earth, tidally locked", () => {
    registerRSSBodies();
    const moon = getBody("Moon");
    expect(moon?.parent).toBe("Earth");
    // Tidally locked → rotationPeriod is the ~27.3-day orbital period.
    expect(moon?.rotationPeriod).toBeGreaterThan(2_000_000);
    expect(moon?.hasAtmosphere).toBe(false);
  });

  it("registers Mars at the RSS datum radius", () => {
    registerRSSBodies();
    expect(getBody("Mars")?.radius).toBe(3_375_800);
  });

  it("flags atmospheres correctly (Earth/Mars/Venus have air, Moon/Sun do not)", () => {
    registerRSSBodies();
    expect(getBody("Earth")?.hasAtmosphere).toBe(true);
    expect(getBody("Mars")?.hasAtmosphere).toBe(true);
    expect(getBody("Venus")?.hasAtmosphere).toBe(true);
    expect(getBody("Moon")?.hasAtmosphere).toBe(false);
    expect(getBody("Sun")?.hasAtmosphere).toBe(false);
  });

  it("stores SOI matching the KSP formula a·(m/M)^0.4", () => {
    registerRSSBodies();
    const sun = getBody("Sun");
    const earth = getBody("Earth");
    const expectSoi = (id: keyof typeof SMA, parentGm: number) => {
      const body = getBody(id);
      const ratio = (body?.gm ?? 0) / parentGm;
      const computed = SMA[id] * ratio ** 0.4;
      // Within 0.1 % of the analytic value.
      expect(Math.abs((body?.soi ?? 0) - computed) / computed).toBeLessThan(
        1e-3,
      );
    };
    expectSoi("Earth", sun?.gm ?? 0);
    expectSoi("Mars", sun?.gm ?? 0);
    expectSoi("Venus", sun?.gm ?? 0);
    expectSoi("Moon", earth?.gm ?? 0);
  });

  it("SOI values sit in the expected real-world bands", () => {
    registerRSSBodies();
    // ~924,600 km, ~66,170 km, ~577,254 km, ~616,281 km.
    expect(getBody("Earth")?.soi).toBeGreaterThan(9.2e8);
    expect(getBody("Earth")?.soi).toBeLessThan(9.3e8);
    expect(getBody("Moon")?.soi).toBeGreaterThan(6.5e7);
    expect(getBody("Moon")?.soi).toBeLessThan(6.7e7);
    expect(getBody("Mars")?.soi).toBeGreaterThan(5.7e8);
    expect(getBody("Mars")?.soi).toBeLessThan(5.8e8);
  });

  it("yields Earth surface gravity of ~1 g through the orbital helper", () => {
    registerRSSBodies();
    const earth = getBody("Earth");
    if (!earth) throw new Error("Earth not registered");
    const g = surfaceGravity(earth, 0);
    expect(g).toBeDefined();
    expect((g ?? 0) / G0).toBeCloseTo(1.0, 2);
  });

  it("yields Mars surface gravity of ~0.38 g", () => {
    registerRSSBodies();
    const mars = getBody("Mars");
    if (!mars) throw new Error("Mars not registered");
    expect((surfaceGravity(mars, 0) ?? 0) / G0).toBeCloseTo(0.383, 2);
  });

  it("gives Earth sea-level pressure of 1 atm and 0 for the airless Moon", () => {
    registerRSSBodies();
    const earth = getBody("Earth");
    const moon = getBody("Moon");
    if (!earth || !moon) throw new Error("bodies not registered");
    expect(pressureAtAltitude(earth, 0)).toBeCloseTo(101_325, 0);
    // Pressure decays with altitude but stays positive inside the atmosphere.
    expect(pressureAtAltitude(earth, 5_000) ?? 0).toBeLessThan(101_325);
    expect(pressureAtAltitude(earth, 5_000) ?? 0).toBeGreaterThan(0);
    // Airless body → undefined.
    expect(pressureAtAltitude(moon, 0)).toBeUndefined();
  });

  it("all bodies with a parent reference a body that is also registered", () => {
    registerRSSBodies();
    const all = getAllBodies();
    const ids = new Set(all.map((b) => b.id));
    for (const body of all) {
      if (body.parent) {
        expect(
          ids.has(body.parent),
          `${body.id}.parent "${body.parent}" not registered`,
        ).toBe(true);
      }
    }
  });

  it("overrides the stock Kerbol Sun when applied on top of stock bodies", () => {
    // Under RSS the body reported as "Sun" is the real Sun, so registering RSS
    // after stock must replace the Kerbol entry rather than leave it.
    registerStockBodies();
    expect(getBody("Sun")?.radius).toBe(261_600_000);
    registerRSSBodies();
    expect(getBody("Sun")?.radius).toBe(696_342_000);
    expect(getBody("Sun")?.name).toBe("Sun");
  });
});
