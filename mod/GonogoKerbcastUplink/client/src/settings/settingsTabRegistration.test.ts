import {
  __clearSettingsTabsForTests,
  getSettingsTabsForScreen,
} from "@ksp-gonogo/core";
import { afterEach, describe, expect, it } from "vitest";
// Importing the real module runs its module-load registerSettingsTab() —
// same pattern as DockingCameraAugment/slot.test.tsx's real-registration test.
import "./KerbcastSettings";

afterEach(() => {
  __clearSettingsTabsForTests();
});

describe("kerbcast settings tab registration", () => {
  it("registers a main-screen-only 'kerbcast' tab", () => {
    const tabs = getSettingsTabsForScreen("main");
    expect(tabs.map((t) => t.id)).toContain("kerbcast");
    expect(getSettingsTabsForScreen("station").map((t) => t.id)).not.toContain(
      "kerbcast",
    );
  });
});
