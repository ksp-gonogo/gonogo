import { Situation } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";

/**
 * A fixture that describes a craft in a healthy orbit must not say it is on the
 * ground or on the water: every widget that reads the situation then draws its
 * refusal ("Landed: no orbit") in place of the orbit the fixture is for, and the
 * widget is snapshot-tested only in that state. The widgets whose fixtures are
 * orbits are checked; a fixture of a descent or a flight keeps its own situation.
 */
const ORBIT_WIDGETS = ["OrbitView", "SemiMajorAxis", "KeplerPeriod"];

/** Fixtures that carry an orbit while the craft is, on purpose, not in a healthy one. */
const NOT_A_HEALTHY_ORBIT = new Set([
  // Its periapsis is inside the atmosphere, so the craft is in flight on a path that meets it.
  "OrbitView/__fixtures__/on-rails-inside-atmosphere.json",
]);

const FIXTURES = import.meta.glob<{ default: Record<string, unknown> }>(
  "../*/__fixtures__/*.json",
  { eager: true },
);

interface Emit {
  channel: string;
  value?: Record<string, unknown>;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const isEmit = (x: unknown): x is Emit =>
  isRecord(x) && typeof x.channel === "string";

const num = (x: unknown): number | undefined => {
  if (typeof x === "number") return x;
  if (isRecord(x) && "magnitude" in x) return Number(x.magnitude);
  return undefined;
};

/** The situation and the closed orbit's periapsis altitude a fixture emits, when it emits both. */
function describes(fixture: Record<string, unknown>) {
  const stream = fixture._stream;
  const raw =
    isRecord(stream) && Array.isArray(stream.emits) ? stream.emits : [];
  const emits = raw.filter(isEmit);
  const orbit = emits.find((e) => e.channel === "vessel.orbit")?.value;
  const identity = emits.find((e) => e.channel === "vessel.identity")?.value;
  const bodies = emits
    .filter(
      (e) =>
        e.channel === "trackingStation.bodies" || e.channel === "system.bodies",
    )
    .flatMap((e) => (Array.isArray(e.value?.bodies) ? e.value.bodies : []))
    .filter(isRecord);
  if (!orbit || !identity) return null;
  const sma = num(orbit.sma);
  const ecc = num(orbit.ecc);
  const body = bodies.find((b) => b.index === orbit.referenceBodyIndex);
  const radius = num(body?.radius);
  const situation = identity.situation;
  if (sma === undefined || ecc === undefined || radius === undefined) {
    return null;
  }
  if (typeof situation !== "number") return null;
  if (!(sma > 0) || !(ecc >= 0 && ecc < 1)) return null;
  return {
    situation,
    periapsisAltitude: sma * (1 - ecc) - radius,
  };
}

describe("fixtures that describe an orbit", () => {
  it("do not put the craft on the ground or the water", () => {
    const wrong: string[] = [];
    for (const [path, mod] of Object.entries(FIXTURES)) {
      const key = path.replace("../", "");
      if (!ORBIT_WIDGETS.some((w) => key.startsWith(`${w}/`))) continue;
      if (NOT_A_HEALTHY_ORBIT.has(key)) continue;
      const found = describes(mod.default);
      if (found === null || found.periapsisAltitude < 0) continue;
      if (
        found.situation === Situation.Landed ||
        found.situation === Situation.Splashed ||
        found.situation === Situation.PreLaunch
      ) {
        wrong.push(`${key}: situation ${found.situation}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
