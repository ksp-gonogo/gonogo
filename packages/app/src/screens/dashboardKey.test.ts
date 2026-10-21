import { describe, expect, it } from "vitest";
import { dashboardKeyForScene } from "./dashboardKey";

describe("dashboardKeyForScene", () => {
  it("keeps the main screen on its own key, in the base slot", () => {
    expect(dashboardKeyForScene("main", undefined)).toBe(
      "gonogo:dashboard:main",
    );
    expect(dashboardKeyForScene("main", "MainMenu")).toBe(
      "gonogo:dashboard:main",
    );
  });

  it("gives each real scene its own slot", () => {
    expect(dashboardKeyForScene("main", "Flight")).toBe(
      "gonogo:dashboard:main:Flight",
    );
    expect(dashboardKeyForScene("main", "Editor")).toBe(
      "gonogo:dashboard:main:Editor",
    );
  });

  it("keeps a pilot's layouts apart from the main screen's in the same scene", () => {
    expect(dashboardKeyForScene("pilot", "Flight")).toBe(
      "gonogo:dashboard:pilot:Flight",
    );
    expect(dashboardKeyForScene("pilot", "Flight")).not.toBe(
      dashboardKeyForScene("main", "Flight"),
    );
  });
});
