import { describe, expect, it } from "vitest";
import {
  emitOf,
  generatedScenes,
  isRecord,
  numberAt,
  recordAt,
} from "../../scripts/gen-landing-status-fixtures";

const MUN_RADIUS = 200_000;

/** The scenes set over the Mun: a Kerbin scene states its own orbit by hand. */
const munScenes = generatedScenes().filter((s) => {
  const bodies = recordAt(emitOf(s.fixture, "system.bodies"), "value").bodies;
  return (
    Array.isArray(bodies) && isRecord(bodies[0]) && bodies[0].name === "Mun"
  );
});

describe("every Mun scene's orbit", () => {
  it("covers the Mun scenes", () => {
    expect(munScenes.length).toBe(20);
  });

  it.each(
    munScenes.map((s) => [s.path, s.fixture] as const),
  )("%s puts the craft at the speed and height its flight figures give", (_path, fixture) => {
    const flight = recordAt(emitOf(fixture, "vessel.flight"), "value");
    const orbit = recordAt(emitOf(fixture, "vessel.orbit"), "value");
    const radius = MUN_RADIUS + numberAt(flight, "altitudeAsl");
    const speedSquared =
      numberAt(orbit, "mu") * (2 / radius - 1 / numberAt(orbit, "sma"));
    expect(Math.sqrt(Math.max(0, speedSquared))).toBeCloseTo(
      numberAt(flight, "orbitalSpeed"),
      0,
    );
  });
});
