import { describe, expect, it } from "vitest";
import {
  findImpactPoint,
  type LegacyOrbitPatch,
  mapOrbitPatch,
  type OrbitPatchWirePayload,
  ROTATION_PERIOD_SECONDS,
} from "./orbit-patches";

function wirePatch(
  overrides: Partial<OrbitPatchWirePayload> = {},
): OrbitPatchWirePayload {
  return {
    sma: 700_000,
    ecc: 0.1,
    inc: 15,
    lan: 30,
    argPe: 45,
    meanAnomalyAtEpoch: 0.5,
    epoch: 100,
    period: 2000,
    startUt: 0,
    endUt: 5000,
    patchStartTransition: 0,
    patchEndTransition: 1,
    peA: 90_000,
    apA: 240_000,
    semiLatusRectum: 690_000,
    semiMinorAxis: 695_000,
    referenceBody: "Kerbin",
    closestEncounterBody: null,
    ...overrides,
  };
}

describe("mapOrbitPatch", () => {
  it("renames wire fields onto the legacy Telemachus OrbitPatch shape", () => {
    const wire = wirePatch();
    const legacy = mapOrbitPatch(wire);
    expect(legacy).toEqual<LegacyOrbitPatch>({
      startUT: wire.startUt,
      endUT: wire.endUt,
      patchStartTransition: "INITIAL",
      patchEndTransition: "FINAL",
      PeA: wire.peA,
      ApA: wire.apA,
      inclination: wire.inc,
      eccentricity: wire.ecc,
      epoch: wire.epoch,
      period: wire.period,
      argumentOfPeriapsis: wire.argPe,
      sma: wire.sma,
      lan: wire.lan,
      maae: wire.meanAnomalyAtEpoch,
      referenceBody: wire.referenceBody,
      semiLatusRectum: wire.semiLatusRectum,
      semiMinorAxis: wire.semiMinorAxis,
      closestEncounterBody: null,
    });
  });

  it("maps every TransitionType ordinal to its legacy uppercase name", () => {
    const names = [
      "INITIAL",
      "FINAL",
      "ENCOUNTER",
      "ESCAPE",
      "MANEUVER",
      "COLLISION",
      "UNKNOWN",
    ];
    names.forEach((name, ordinal) => {
      const legacy = mapOrbitPatch(
        wirePatch({ patchStartTransition: ordinal }),
      );
      expect(legacy.patchStartTransition).toBe(name);
    });
  });

  it("falls back to UNKNOWN for an out-of-range ordinal", () => {
    const legacy = mapOrbitPatch(wirePatch({ patchStartTransition: 99 }));
    expect(legacy.patchStartTransition).toBe("UNKNOWN");
  });

  it("preserves a non-null closestEncounterBody", () => {
    const legacy = mapOrbitPatch(wirePatch({ closestEncounterBody: "Mun" }));
    expect(legacy.closestEncounterBody).toBe("Mun");
  });
});

describe("findImpactPoint", () => {
  // Short synthetic period so apoapsis→periapsis (half a period) is a small,
  // easy-to-bound horizon. `sma`/`ecc` chosen so periapsis radius (100_000)
  // sits well below the 200_000 body radius and apoapsis (400_000) well
  // above it.
  const CROSSING_PATCH: LegacyOrbitPatch = {
    startUT: 0,
    endUT: 100,
    patchStartTransition: "INITIAL",
    patchEndTransition: "FINAL",
    PeA: 0,
    ApA: 0,
    inclination: 0,
    eccentricity: 0.6,
    epoch: 0,
    period: 12,
    argumentOfPeriapsis: 0,
    sma: 250_000,
    lan: 0,
    maae: Math.PI, // apoapsis at t=0
    referenceBody: "Kerbin",
    semiLatusRectum: 0,
    semiMinorAxis: 0,
    closestEncounterBody: null,
  };

  it("returns the last pre-surface sample when the patch crosses the surface", () => {
    const impact = findImpactPoint(
      [CROSSING_PATCH],
      "Kerbin",
      200_000,
      21549.425,
      { ut: 0, lat: 0, lon: 0 },
      10,
      0.5,
    );
    expect(impact).not.toBeNull();
    expect(Number.isFinite(impact?.lat)).toBe(true);
    expect(Number.isFinite(impact?.lon)).toBe(true);
  });

  it("returns null when the patch never dips below the surface within the horizon", () => {
    const CIRCULAR: LegacyOrbitPatch = {
      ...CROSSING_PATCH,
      eccentricity: 0,
      maae: 0,
    };
    const impact = findImpactPoint(
      [CIRCULAR],
      "Kerbin",
      200_000,
      21549.425,
      { ut: 0, lat: 0, lon: 0 },
      10,
      0.5,
    );
    expect(impact).toBeNull();
  });

  it("returns null for an empty patch list", () => {
    expect(
      findImpactPoint(
        [],
        "Kerbin",
        200_000,
        21549.425,
        { ut: 0, lat: 0, lon: 0 },
        10,
        1,
      ),
    ).toBeNull();
  });

  it("returns null when no patch matches the requested body", () => {
    const impact = findImpactPoint(
      [CROSSING_PATCH],
      "Mun",
      200_000,
      138984.38,
      { ut: 0, lat: 0, lon: 0 },
      10,
      0.5,
    );
    expect(impact).toBeNull();
  });

  it("returns null for a non-positive horizon or step", () => {
    expect(
      findImpactPoint(
        [CROSSING_PATCH],
        "Kerbin",
        200_000,
        21549.425,
        { ut: 0, lat: 0, lon: 0 },
        0,
        0.5,
      ),
    ).toBeNull();
    expect(
      findImpactPoint(
        [CROSSING_PATCH],
        "Kerbin",
        200_000,
        21549.425,
        { ut: 0, lat: 0, lon: 0 },
        10,
        0,
      ),
    ).toBeNull();
  });
});

describe("ROTATION_PERIOD_SECONDS", () => {
  it("carries an entry for every stock body", () => {
    for (const body of [
      "Kerbol",
      "Moho",
      "Eve",
      "Gilly",
      "Kerbin",
      "Mun",
      "Minmus",
      "Duna",
      "Ike",
      "Dres",
      "Jool",
      "Laythe",
      "Vall",
      "Tylo",
      "Bop",
      "Pol",
      "Eeloo",
    ]) {
      expect(ROTATION_PERIOD_SECONDS[body]).toBeGreaterThan(0);
    }
  });
});
