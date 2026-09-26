import { describe, expect, it } from "vitest";

/**
 * Every fixture that puts a `vessel.orbit` sample on the wire states its
 * propagation horizon. The wire field is not nullable and the stock producer
 * always fills it, so an omission records a producer that dropped a required
 * field, and every `useOrbitTrajectory` widget draws nothing. Gated on the
 * shared fixtures, which feed three harnesses at once. A scene with genuinely
 * no horizon says so in `_meta.horizonAbsent`.
 */

const FIXTURES = import.meta.glob<{ default: Record<string, unknown> }>(
  "../*/__*__/**/*.json",
  { eager: true },
);

interface OrbitEmit {
  channel?: string;
  value?: { horizon?: { kind?: number; trajectoryKind?: number } };
}

interface FixtureShape {
  _meta?: { horizonAbsent?: string };
  _stream?: { emits?: OrbitEmit[] };
}

/** Fixture path -> its `vessel.orbit` emits, for every fixture that has any. */
function orbitFixtures(): Array<[string, FixtureShape, OrbitEmit[]]> {
  const out: Array<[string, FixtureShape, OrbitEmit[]]> = [];
  for (const [path, mod] of Object.entries(FIXTURES)) {
    const fixture = mod.default as FixtureShape;
    const emits = fixture._stream?.emits;
    if (!Array.isArray(emits)) continue;
    const orbits = emits.filter((e) => e?.channel === "vessel.orbit");
    if (orbits.length > 0) out.push([path, fixture, orbits]);
  }
  return out;
}

describe("vessel.orbit fixtures state their propagation horizon", () => {
  it("finds the fixtures at all, so an empty sweep cannot pass as a clean one", () => {
    // A glob that matched nothing would report zero omissions.
    expect(orbitFixtures().length).toBeGreaterThan(90);
  });

  it("leaves no fixture silently without one", () => {
    const missing = orbitFixtures()
      .filter(([, fixture]) => fixture._meta?.horizonAbsent === undefined)
      .filter(([, , orbits]) =>
        orbits.some((e) => e.value?.horizon === undefined),
      )
      .map(([path]) => path.replace("../", ""));
    expect(missing).toEqual([]);
  });

  it("states the SHAPE and not only the reach", () => {
    // Reach alone leaves `trajectoryKind` `Unspecified`, which the seam refuses like no horizon at all.
    const shapeless = orbitFixtures()
      .filter(([, fixture]) => fixture._meta?.horizonAbsent === undefined)
      .filter(([, , orbits]) =>
        orbits.some(
          (e) =>
            e.value?.horizon !== undefined &&
            (e.value.horizon.trajectoryKind ?? 0) === 0,
        ),
      )
      .map(([path]) => path.replace("../", ""));
    expect(shapeless).toEqual([]);
  });
});
