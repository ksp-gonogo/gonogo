import { getComponent } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import "./CommcastComponent";

describe("Commcast on a phone", () => {
  it("takes the whole row, since half a phone is narrower than its bar", () => {
    expect(getComponent("commcast")?.mobileWidth).toBe("full");
  });
});

describe("Commcast's tile sizes", () => {
  it("leaves the thread room for messages at the smallest size it allows", () => {
    const def = getComponent("commcast");
    expect(def?.minSize).toEqual({ w: 8, h: 9 });
    expect(def?.defaultSize).toEqual({ w: 10, h: 10 });
    expect(def?.mobileHeight).toBe(720);
  });
});
