import { describe, expect, it } from "vitest";
import {
  bodyDetail,
  distanceFromHome,
  type RosterBody,
  VISITED_DETAIL_STEP,
} from "./bodyDetail";
import { detailFromApparentSize } from "./pencilSketch";

const ROSTER: RosterBody[] = (
  [
    { name: "Sun", index: 0, parentIndex: undefined, radius: 261_600_000 },
    {
      name: "Kerbin",
      index: 1,
      parentIndex: 0,
      radius: 600_000,
      sma: 13_599_840_256,
      isHome: true,
    },
    {
      name: "Mun",
      index: 2,
      parentIndex: 1,
      radius: 200_000,
      sma: 12_000_000,
    },
    {
      name: "Duna",
      index: 3,
      parentIndex: 0,
      radius: 320_000,
      sma: 20_726_155_264,
    },
    {
      name: "Ike",
      index: 4,
      parentIndex: 3,
      radius: 130_000,
      sma: 3_200_000,
    },
    {
      name: "Eeloo",
      index: 5,
      parentIndex: 0,
      radius: 210_000,
      sma: 90_118_820_000,
    },
  ] as (Omit<RosterBody, "isHome"> & { isHome?: boolean })[]
).map((b) => ({ isHome: false, ...b }));

const named = (n: string) => ROSTER.find((b) => b.name === n) as RosterBody;

describe("distanceFromHome", () => {
  it("is a moon's own orbit for a moon of the home body", () => {
    expect(distanceFromHome(ROSTER, named("Kerbin"), named("Mun"))).toBe(
      12_000_000,
    );
  });

  it("combines both planets' orbits about the star for another planet", () => {
    expect(
      distanceFromHome(ROSTER, named("Kerbin"), named("Duna")),
    ).toBeCloseTo(Math.hypot(13_599_840_256, 20_726_155_264), 0);
  });

  it("places a moon of another planet at its planet's distance", () => {
    expect(distanceFromHome(ROSTER, named("Kerbin"), named("Ike"))).toBe(
      distanceFromHome(ROSTER, named("Kerbin"), named("Duna")),
    );
  });

  it("is zero for the home body and unknown where an orbit is missing", () => {
    expect(distanceFromHome(ROSTER, named("Kerbin"), named("Kerbin"))).toBe(0);
    const bare = ROSTER.map((b) =>
      b.name === "Mun" ? { ...b, sma: undefined } : b,
    );
    expect(distanceFromHome(bare, bare[1], bare[2])).toBeUndefined();
  });
});

describe("bodyDetail", () => {
  it("is full for the home body", () => {
    expect(bodyDetail(ROSTER, "Kerbin", false)).toBe(1);
  });

  it("falls with how small the body looks from home", () => {
    const mun = bodyDetail(ROSTER, "Mun", false);
    const duna = bodyDetail(ROSTER, "Duna", false);
    const eeloo = bodyDetail(ROSTER, "Eeloo", false);
    expect(mun).toBeGreaterThan(duna);
    expect(duna).toBeGreaterThan(eeloo);
    expect(duna).toBeCloseTo(
      detailFromApparentSize(
        320_000 / Math.hypot(13_599_840_256, 20_726_155_264),
      ),
      6,
    );
  });

  it("lifts a body a craft is flying at by one step, up to full", () => {
    const natural = bodyDetail(ROSTER, "Duna", false);
    expect(bodyDetail(ROSTER, "Duna", true)).toBeCloseTo(
      natural + VISITED_DETAIL_STEP,
      6,
    );
    expect(bodyDetail(ROSTER, "Kerbin", true)).toBe(1);
  });

  it("draws in full a body the roster cannot place", () => {
    expect(bodyDetail(undefined, "Duna", false)).toBe(1);
    expect(bodyDetail(ROSTER, "Dres", false)).toBe(1);
    expect(bodyDetail(ROSTER, undefined, false)).toBe(1);
    expect(
      bodyDetail(
        ROSTER.filter((b) => !b.isHome),
        "Duna",
        false,
      ),
    ).toBe(1);
  });
});
