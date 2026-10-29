import { describe, expect, it } from "vitest";
import { buildStageStack } from "./stageStack";

const part = (stage: number | null, title: string) => ({
  stage,
  title,
  name: title,
});

describe("buildStageStack", () => {
  it("lists the highest stage first and counts repeated parts", () => {
    const stack = buildStageStack([
      part(0, "Parachute"),
      part(2, "Engine"),
      part(1, "Decoupler"),
      part(1, "Decoupler"),
    ]);
    expect(stack.map((s) => s.stage)).toEqual([2, 1, 0]);
    expect(stack[1].parts).toEqual([{ title: "Decoupler", count: 2 }]);
  });

  it("leaves out parts that are never staged", () => {
    const stack = buildStageStack([part(null, "Tank"), part(-1, "Strut")]);
    expect(stack).toEqual([]);
  });

  it("marks the current stage and the spent ones above it", () => {
    const stack = buildStageStack(
      [part(2, "A"), part(1, "B"), part(0, "C")],
      1,
    );
    expect(stack.map((s) => [s.stage, s.current, s.spent])).toEqual([
      [2, false, true],
      [1, true, false],
      [0, false, false],
    ]);
  });

  it("marks nothing current when the vessel's stage is unknown", () => {
    const stack = buildStageStack([part(1, "A")], null);
    expect(stack[0]).toMatchObject({ current: false, spent: false });
  });
});
