import { afterEach, describe, expect, it } from "vitest";
import {
  __clearSettingsTabsForTests,
  getSettingsTabs,
  getSettingsTabsForScreen,
  registerSettingsTab,
} from "./settingsTabs";

function Stub() {
  return null;
}

afterEach(() => {
  __clearSettingsTabsForTests();
});

describe("settingsTabs", () => {
  it("registers a tab and returns it", () => {
    registerSettingsTab({ id: "t1", label: "T1", component: Stub });
    expect(getSettingsTabs().map((t) => t.id)).toEqual(["t1"]);
  });

  it("re-registering the same id replaces the previous definition", () => {
    registerSettingsTab({ id: "t1", label: "First", component: Stub });
    registerSettingsTab({ id: "t1", label: "Second", component: Stub });
    expect(getSettingsTabs()).toHaveLength(1);
    expect(getSettingsTabs()[0]?.label).toBe("Second");
  });

  it("filters by screen when screens is set", () => {
    registerSettingsTab({
      id: "main-only",
      label: "M",
      component: Stub,
      screens: ["main"],
    });
    registerSettingsTab({ id: "both", label: "B", component: Stub });
    expect(
      getSettingsTabsForScreen("main")
        .map((t) => t.id)
        .sort(),
    ).toEqual(["both", "main-only"]);
    expect(getSettingsTabsForScreen("station").map((t) => t.id)).toEqual([
      "both",
    ]);
  });
});
