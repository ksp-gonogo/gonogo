import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { computeCmeEntities } from "./contribution";

/** A vessel-to-star unit vector pointing straight along +x (i.e. the star
 *  sits at the vessel's +x): the negated bearing this produces (star-to-
 *  vessel) is -x, so a storm on this star pulses toward -x, distance `dist`. */
function starDirection(x: number, y: number, z: number) {
  return {
    star: "Kerbol",
    direction: {
      x: value("1", x),
      y: value("1", y),
      z: value("1", z),
    },
  };
}

describe("computeCmeEntities", () => {
  it("renders nothing when there is no space-weather payload (Kerbalism absent)", () => {
    expect(computeCmeEntities(undefined)).toEqual([]);
  });

  it("renders nothing when there are no storms", () => {
    expect(computeCmeEntities({})).toEqual([]);
    expect(computeCmeEntities({ storms: [] })).toEqual([]);
  });

  it("skips a storm slot with stormState 0 (none)", () => {
    expect(
      computeCmeEntities({
        storms: [{ star: "Kerbol", stormState: value("count", 0) }],
      }),
    ).toEqual([]);
  });

  it("skips a storm slot missing its star name or distance", () => {
    expect(
      computeCmeEntities({
        stars: [starDirection(1, 0, 0)],
        storms: [{ stormState: value("count", 1), dist: value("m", 1e10) }],
      }),
    ).toEqual([]);
    expect(
      computeCmeEntities({
        stars: [starDirection(1, 0, 0)],
        storms: [{ star: "Kerbol", stormState: value("count", 1) }],
      }),
    ).toEqual([]);
    expect(
      computeCmeEntities({
        stars: [starDirection(1, 0, 0)],
        storms: [
          {
            star: "Kerbol",
            stormState: value("count", 1),
            dist: value("m", 0),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("skips a storm slot when `stars` has no matching bearing (defensive: shouldn't happen on the real wire)", () => {
    expect(
      computeCmeEntities({
        storms: [
          {
            star: "Kerbol",
            stormState: value("count", 1),
            dist: value("m", 13_599_840_256),
          },
        ],
      }),
    ).toEqual([]);
    // A `stars` entry for a DIFFERENT star doesn't count.
    expect(
      computeCmeEntities({
        stars: [starDirection(1, 0, 0)].map((s) => ({
          ...s,
          star: "Kerbol B",
        })),
        storms: [
          {
            star: "Kerbol",
            stormState: value("count", 1),
            dist: value("m", 13_599_840_256),
          },
        ],
      }),
    ).toEqual([]);
    // A zero direction vector can't form a bearing either.
    expect(
      computeCmeEntities({
        stars: [starDirection(0, 0, 0)],
        storms: [
          {
            star: "Kerbol",
            stormState: value("count", 1),
            dist: value("m", 13_599_840_256),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("draws a faint travelling pulse from the star toward the body's bearing, for an inbound storm (stormState 1)", () => {
    const [entity] = computeCmeEntities({
      stormEjectionSpeed: value("m/s", 99_000_000),
      stars: [starDirection(1, 0, 0)],
      storms: [
        {
          star: "Kerbol",
          stormState: value("count", 1),
          stormTime: value("ut", 5_000_000),
          stormDuration: value("s", 3_600),
          dist: value("m", 13_599_840_256),
        },
      ],
    });
    expect(entity).toEqual({
      id: "cme:Kerbol",
      position: {
        kind: "fixed",
        parentName: "Kerbol",
        xMetres: 0,
        yMetres: 0,
        zMetres: 0,
      },
      shape: {
        kind: "travelling-pulse",
        // direction (1,0,0) negated -> bearing (-1,0,0) * dist.
        to: {
          kind: "fixed",
          parentName: "Kerbol",
          xMetres: -13_599_840_256,
          yMetres: 0,
          zMetres: 0,
        },
        // ejectionSpeedMps (99e6) * durationS (3_600) = 3.564e11, well past
        // `dist` (13.6e9), so the segment clamps to the full apex->tip span.
        segmentLengthMetres: 13_599_840_256,
        arriveUt: 5_000_000,
        clearUt: 5_003_600,
      },
      style: { emphasis: "faint", severity: "warning" },
      meta: {
        star: "Kerbol",
        state: "inbound",
        distM: 13_599_840_256,
        durationS: 3_600,
        ejectionSpeedMps: 99_000_000,
        arrivalUt: 5_000_000,
      },
    });
  });

  it("keeps the out-of-plane component of the bearing", () => {
    // The game's `y` is out of the ecliptic and SystemView's third component is
    // too. This used to keep x and z and throw y away, on the stated grounds
    // that the diagram flattened everything anyway; it does not, so a bearing
    // missing this put an interplanetary front in the ecliptic when the storm
    // was not. A 45-degree direction, so the dropped component was the same
    // size as the ones that were kept.
    const dist = 13_599_840_256;
    const [entity] = computeCmeEntities({
      stormEjectionSpeed: value("m/s", 99_000_000),
      stars: [starDirection(1, 1, 0)],
      storms: [
        {
          star: "Kerbol",
          stormState: value("count", 1),
          stormTime: value("ut", 5_000_000),
          stormDuration: value("s", 3_600),
          dist: value("m", dist),
        },
      ],
    });
    const to =
      entity.shape.kind === "travelling-pulse" ? entity.shape.to : null;
    if (to === null || to.kind !== "fixed") throw new Error("no bearing drawn");
    const leg = -dist / Math.SQRT2;
    expect(to.xMetres).toBeCloseTo(leg, 0);
    expect(to.zMetres).toBeCloseTo(leg, 0);
    expect(to.yMetres).toBeCloseTo(0, 6);
    // Still a unit bearing scaled to the distance, which is the invariant a
    // per-component fix is easiest to break.
    expect(Math.hypot(to.xMetres, to.yMetres, to.zMetres)).toBeCloseTo(dist, 0);
  });

  it("derives the segment length from ejection speed * active duration when it's SHORTER than the full apex->tip distance", () => {
    const [entity] = computeCmeEntities({
      stormEjectionSpeed: value("m/s", 1_000_000),
      stars: [starDirection(1, 0, 0)],
      storms: [
        {
          star: "Kerbol",
          stormState: value("count", 1),
          stormTime: value("ut", 1_000),
          stormDuration: value("s", 3_600),
          dist: value("m", 13_599_840_256),
        },
      ],
    });
    expect(entity?.shape).toMatchObject({
      kind: "travelling-pulse",
      segmentLengthMetres: 1_000_000 * 3_600,
      arriveUt: 1_000,
      clearUt: 4_600,
    });
  });

  it("skips a storm slot missing its active duration or the weather's ejection speed, never fabricating a segment length", () => {
    expect(
      computeCmeEntities({
        stormEjectionSpeed: value("m/s", 99_000_000),
        stars: [starDirection(1, 0, 0)],
        storms: [
          {
            star: "Kerbol",
            stormState: value("count", 1),
            dist: value("m", 13_599_840_256),
            // no stormDuration
          },
        ],
      }),
    ).toEqual([]);
    expect(
      computeCmeEntities({
        // no stormEjectionSpeed at all
        stars: [starDirection(1, 0, 0)],
        storms: [
          {
            star: "Kerbol",
            stormState: value("count", 1),
            stormDuration: value("s", 3_600),
            dist: value("m", 13_599_840_256),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("skips a storm slot missing its arrival UT, never fabricating the wave's timing window", () => {
    expect(
      computeCmeEntities({
        stormEjectionSpeed: value("m/s", 99_000_000),
        stars: [starDirection(1, 0, 0)],
        storms: [
          {
            star: "Kerbol",
            stormState: value("count", 1),
            stormDuration: value("s", 3_600),
            dist: value("m", 13_599_840_256),
            // no stormTime
          },
        ],
      }),
    ).toEqual([]);
  });

  it("projects the bearing off the direction vector's x/z only, dropping y (this diagram's own flattened plane)", () => {
    const [entity] = computeCmeEntities({
      // Straight "up" (y) plus a unit x component: only x/z should reach
      // the bearing, y is dropped entirely, not folded into the magnitude.
      stars: [starDirection(0, 5, 0)].map((s) => ({
        ...s,
        direction: {
          x: value("1", 0),
          y: value("1", 5),
          z: value("1", 0),
        },
      })),
      storms: [
        {
          star: "Kerbol",
          stormState: value("count", 1),
          dist: value("m", 1e10),
        },
      ],
    });
    // x and z both zero -> no planar bearing -> skipped, never a fabricated one.
    expect(entity).toBeUndefined();
  });

  it("raises an arrived storm (stormState 2) to normal emphasis, same warn severity throughout", () => {
    const [entity] = computeCmeEntities({
      stormEjectionSpeed: value("m/s", 1_000_000),
      stars: [starDirection(1, 0, 0)],
      storms: [
        {
          star: "Kerbol",
          stormState: value("count", 2),
          stormTime: value("ut", 1_000),
          stormDuration: value("s", 1_800),
          dist: value("m", 13_599_840_256),
        },
      ],
    });
    // Severity, not a token: which hue "warn" becomes is SystemView's to
    // decide, and an Uplink naming the colour itself is the thing this
    // asserts has not come back. Only the emphasis tracks the state.
    expect(entity?.style).toEqual({
      emphasis: "normal",
      severity: "warning",
    });
    expect(entity?.meta?.state).toBe("in progress");
  });

  it("never sets a zHint: relies on the travelling-pulse shape's own default layer (below connection-line/point, above orbit-path)", () => {
    const [entity] = computeCmeEntities({
      stormEjectionSpeed: value("m/s", 1_000_000),
      stars: [starDirection(1, 0, 0)],
      storms: [
        {
          star: "Kerbol",
          stormState: value("count", 1),
          stormTime: value("ut", 1_000),
          stormDuration: value("s", 1_800),
          dist: value("m", 1e10),
        },
      ],
    });
    expect(entity?.shape.kind).toBe("travelling-pulse");
    expect(entity?.zHint).toBeUndefined();
  });

  it("draws one entity per storm slot, e.g. a modded binary star", () => {
    const entities = computeCmeEntities({
      stormEjectionSpeed: value("m/s", 1_000_000),
      stars: [
        starDirection(1, 0, 0),
        { ...starDirection(0, 0, 1), star: "Kerbol B" },
      ],
      storms: [
        {
          star: "Kerbol",
          stormState: value("count", 1),
          stormTime: value("ut", 1_000),
          stormDuration: value("s", 1_800),
          dist: value("m", 1e10),
        },
        {
          star: "Kerbol B",
          stormState: value("count", 2),
          stormTime: value("ut", 2_000),
          stormDuration: value("s", 1_800),
          dist: value("m", 2e10),
        },
      ],
    });
    expect(entities.map((e) => e.id)).toEqual(["cme:Kerbol", "cme:Kerbol B"]);
  });
});
