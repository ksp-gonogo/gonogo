import { describe, expect, it } from "vitest";
import { isAwaitingFirstSignal } from "./useAwaitingFirstSignal";

describe("isAwaitingFirstSignal", () => {
  it("is true for a link report that has not arrived yet", () => {
    expect(isAwaitingFirstSignal({ state: "pending" })).toBe(true);
    expect(isAwaitingFirstSignal({ state: "absent" })).toBe(false);
    expect(isAwaitingFirstSignal({ state: "observed" })).toBe(false);
  });

  it("is true for a link left behind by a time jump, whose next report is still crossing", () => {
    expect(isAwaitingFirstSignal({ state: "held", grade: "held" })).toBe(true);
  });

  it("is true for a link held while the game loads a scene", () => {
    expect(isAwaitingFirstSignal({ state: "held", grade: "loading" })).toBe(
      true,
    );
  });

  it("is false for a hold with another stated cause", () => {
    for (const grade of [
      "disconnected",
      "last-before-blackout",
      "recorded",
      "no-game",
    ]) {
      expect(isAwaitingFirstSignal({ state: "held", grade })).toBe(false);
    }
  });
});
