import { describe, expect, it } from "vitest";
import { isAwaitingFirstSignal } from "./useAwaitingFirstSignal";

describe("isAwaitingFirstSignal", () => {
  it("is true only for a link report that has not arrived yet", () => {
    expect(isAwaitingFirstSignal({ state: "pending" })).toBe(true);
    expect(isAwaitingFirstSignal({ state: "absent" })).toBe(false);
    expect(isAwaitingFirstSignal({ state: "observed" })).toBe(false);
    expect(isAwaitingFirstSignal({ state: "held" })).toBe(false);
  });
});
