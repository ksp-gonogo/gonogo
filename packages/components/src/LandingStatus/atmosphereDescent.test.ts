import { describe, expect, it } from "vitest";
import {
  atmosphereChannelsFor,
  integrateAtmosphere,
  LOW_DESCENT,
} from "../../scripts/landingAtmosphereModel";
import { channelsFor } from "../../scripts/landingDescentModel";

describe.each([
  ["a land descent", { ocean: false }, undefined],
  ["an ocean descent", { ocean: true }, undefined],
  ["the last stretch over the sea", { ocean: true }, LOW_DESCENT],
])("%s", (_name, world, start) => {
  const frames = integrateAtmosphere(world, start);
  const flying = frames.filter((f) => !f.landed);

  it("falls the whole way and ends settled on the surface", () => {
    expect(frames[frames.length - 1].landed).toBe(true);
    for (let i = 1; i < flying.length; i++) {
      expect(flying[i].aglMeters).toBeLessThan(flying[i - 1].aglMeters);
    }
  });

  it("opens a canopy low down and touches down at a speed a capsule survives", () => {
    const opened = flying.find((f) => f.canopy > 0);
    expect(opened?.aglMeters).toBeLessThan(2500);
    const last = flying[flying.length - 1];
    expect(Math.hypot(last.vDown, last.vHoriz)).toBeLessThan(12);
  });

  it("never speeds up or slows by more than the air can: no step is a leap", () => {
    for (let i = 1; i < flying.length; i++) {
      const a = Math.hypot(flying[i - 1].vDown, flying[i - 1].vHoriz);
      const b = Math.hypot(flying[i].vDown, flying[i].vHoriz);
      expect(Math.abs(a - b), `t=${flying[i].t}`).toBeLessThan(60);
    }
  });
});

describe("the stream of a capsule's frame", () => {
  const stream = (ocean: boolean) => {
    const frame = integrateAtmosphere({ ocean })[40];
    return atmosphereChannelsFor(frame, { ocean }, channelsFor(frame, 4));
  };
  const landing = (ocean: boolean) => {
    const l = stream(ocean)["vessel.landing"];
    if (typeof l !== "object" || l === null) throw new Error("no landing");
    return l;
  };

  it("says the body has an ocean and that the capsule has no engine", () => {
    const bodies = stream(true)["system.bodies"];
    expect(JSON.stringify(bodies)).toContain('"hasOcean":true');
    const propulsion = stream(true)["vessel.propulsion"];
    expect(JSON.stringify(propulsion)).toContain('"availableThrust":0');
  });

  it("reads the sea floor below the surface over the ocean and land above it over land", () => {
    const floor = Reflect.get(landing(true), "groundTrackElevations");
    const land = Reflect.get(landing(false), "groundTrackElevations");
    expect(Math.max(...floor)).toBeLessThan(0);
    expect(Math.min(...land)).toBeGreaterThan(0);
  });
});
