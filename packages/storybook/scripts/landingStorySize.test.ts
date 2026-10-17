import "@ksp-gonogo/components";
import { getComponent } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_SIZE, MIN_SIZE } from "./landingStorySize";

describe("the Landing Status stories", () => {
  it("show the widget at the default size it registers", () => {
    expect(getComponent("landing-status")?.defaultSize).toEqual(DEFAULT_SIZE);
  });

  it("show the widget at the smallest size it registers", () => {
    expect(getComponent("landing-status")?.minSize).toEqual(MIN_SIZE);
  });
});
