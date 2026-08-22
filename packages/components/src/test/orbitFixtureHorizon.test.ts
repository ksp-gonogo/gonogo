import { describe, expect, it } from "vitest";

/**
 * Every fixture that puts a `vessel.orbit` sample on the wire has to state the
 * propagation horizon riding on it.
 *
 * `VesselOrbit.Horizon` is not nullable on the wire and the stock producer
 * always fills it in (`AnalyticHorizon()` in `VesselViewProvider.cs`: reach
 * `Unbounded`, shape `Analytic`). A fixture that omits it is therefore not a
 * neutral recording of a scene, it is a recording of a producer that dropped a
 * required field, and the client seam reads that as unpropagatable. Every
 * widget that asks `useOrbitTrajectory` what to draw is told to draw nothing.
 *
 * The gate is on the FIXTURES rather than on a widget because the fixtures are
 * shared: the same file feeds the vitest DOM harness, the a11y sweep and the
 * playwright probe, so one omission is refused in three places at once and each
 * of them reads as the widget's own empty state.
 *
 * A fixture whose scene genuinely has no horizon to state is a legitimate case
 * and is recorded rather than filled in: say so in `_meta.horizonAbsent` and
 * the gate passes it through. That field exists so the refusal path keeps
 * fixture coverage, and so the reason is written next to the fixture instead of
 * living in a list somewhere else.
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
    // A glob that matched nothing would report zero omissions and read as
    // success, which is the failure mode this whole file is about.
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
    // Reach alone leaves `trajectoryKind` at `Unspecified`, which is what a
    // producer that forgot the field sends. The seam refuses it deliberately,
    // so a fixture stating half a horizon draws exactly as little as one
    // stating none, while looking like it stated something.
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
