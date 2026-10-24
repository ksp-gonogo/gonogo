import { describe, expect, it } from "vitest";
import { stageToFire } from "./stageToFire";

describe("stageToFire", () => {
  it("reads one below the vessel's current stage", () => {
    expect(stageToFire(2)).toBe(1);
    expect(stageToFire(1)).toBe(0);
  });

  it("stays at 0 once no stage remains", () => {
    expect(stageToFire(0)).toBe(0);
  });
});
