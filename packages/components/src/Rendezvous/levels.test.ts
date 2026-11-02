import { describe, expect, it } from "vitest";
import {
  APPROACH_ENTER_M,
  APPROACH_EXIT_M,
  DOCKING_ENTER_M,
  DOCKING_EXIT_M,
  ENCOUNTER_ENTER_SOI,
  ENCOUNTER_EXIT_SOI,
  followingLevel,
  hasLevel,
  type LevelInput,
  nextLevel,
  previousLevel,
} from "./levels";

const craft = (over: Partial<LevelInput> = {}): LevelInput => ({
  target: "craft",
  range: 10_000,
  dockingAvailable: false,
  rangeInSoi: undefined,
  pathEntersBody: false,
  ...over,
});
const body = (over: Partial<LevelInput> = {}): LevelInput => ({
  target: "body",
  range: 5e6,
  dockingAvailable: false,
  rangeInSoi: 4,
  pathEntersBody: false,
  ...over,
});

describe("nextLevel for a craft", () => {
  it("is Far while the target is out of the approach scale", () => {
    expect(nextLevel("far", craft({ range: APPROACH_ENTER_M + 1 }))).toBe(
      "far",
    );
  });

  it("enters Approach inside the approach scale and leaves it only outside the wider edge", () => {
    expect(nextLevel("far", craft({ range: APPROACH_ENTER_M - 1 }))).toBe(
      "approach",
    );
    expect(
      nextLevel("approach", craft({ range: APPROACH_ENTER_M + 100 })),
    ).toBe("approach");
    expect(nextLevel("approach", craft({ range: APPROACH_EXIT_M + 1 }))).toBe(
      "far",
    );
  });

  it("enters Docking only when a port can be docked with, and holds it to the wider edge", () => {
    expect(nextLevel("approach", craft({ range: DOCKING_ENTER_M - 1 }))).toBe(
      "approach",
    );
    expect(
      nextLevel(
        "approach",
        craft({ range: DOCKING_ENTER_M - 1, dockingAvailable: true }),
      ),
    ).toBe("docking");
    expect(
      nextLevel(
        "docking",
        craft({ range: DOCKING_EXIT_M - 1, dockingAvailable: true }),
      ),
    ).toBe("docking");
    expect(
      nextLevel(
        "docking",
        craft({ range: DOCKING_EXIT_M + 1, dockingAvailable: true }),
      ),
    ).toBe("approach");
  });

  it("falls back to Docking's neighbour when the port is no longer reported", () => {
    expect(
      nextLevel("docking", craft({ range: 20, dockingAvailable: false })),
    ).toBe("approach");
  });

  it("is Far while the range is not known", () => {
    expect(nextLevel("approach", craft({ range: undefined }))).toBe("far");
    expect(nextLevel("approach", craft({ range: Number.NaN }))).toBe("far");
  });
});

describe("nextLevel for a body", () => {
  it("is Far until the path enters the sphere of influence or the craft is within the encounter scale of it", () => {
    expect(
      nextLevel("far", body({ rangeInSoi: ENCOUNTER_ENTER_SOI + 0.1 })),
    ).toBe("far");
    expect(
      nextLevel("far", body({ rangeInSoi: ENCOUNTER_ENTER_SOI - 0.1 })),
    ).toBe("encounter");
    expect(
      nextLevel("far", body({ pathEntersBody: true, rangeInSoi: 9 })),
    ).toBe("encounter");
  });

  it("holds Encounter out to the wider edge", () => {
    expect(
      nextLevel("encounter", body({ rangeInSoi: ENCOUNTER_EXIT_SOI - 0.1 })),
    ).toBe("encounter");
    expect(
      nextLevel("encounter", body({ rangeInSoi: ENCOUNTER_EXIT_SOI + 0.1 })),
    ).toBe("far");
  });

  it("never gives a body a Docking level, whatever the range", () => {
    expect(
      nextLevel(
        "far",
        body({ range: 5, dockingAvailable: true, rangeInSoi: 9 }),
      ),
    ).toBe("far");
  });
});

describe("the order of the levels", () => {
  it("steps a craft Far, Approach, Docking and a body Far, Encounter", () => {
    expect(previousLevel("craft", "far")).toBeNull();
    expect(previousLevel("craft", "docking")).toBe("approach");
    expect(followingLevel("craft", "far")).toBe("approach");
    expect(followingLevel("craft", "docking")).toBeNull();
    expect(previousLevel("body", "encounter")).toBe("far");
    expect(followingLevel("body", "encounter")).toBeNull();
  });

  it("says which levels belong to which target", () => {
    expect(hasLevel("body", "docking")).toBe(false);
    expect(hasLevel("craft", "encounter")).toBe(false);
    expect(hasLevel("craft", "docking")).toBe(true);
  });
});
