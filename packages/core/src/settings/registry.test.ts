import { afterEach, describe, expect, it } from "vitest";
import {
  __clearSettingsForTests,
  getAllSettings,
  getSettingDefinition,
  getSettingsForScreen,
  registerSetting,
} from "./registry";

afterEach(() => {
  __clearSettingsForTests();
});

describe("settings registry — two backings", () => {
  it("stores a client-pref setting (backing omitted defaults to client-pref)", () => {
    registerSetting({
      id: "feat.flag",
      type: "boolean",
      label: "Flag",
      category: "Test",
      defaultValue: true,
    });
    const def = getSettingDefinition("feat.flag");
    expect(def?.backing).toBeUndefined();
    // narrows to ClientPrefSetting — defaultValue is present
    expect(def && def.backing !== "source-backed" && def.defaultValue).toBe(
      true,
    );
  });

  it("stores a source-backed setting with its binding closures", () => {
    let stored = false;
    registerSetting({
      id: "feat.sourced",
      backing: "source-backed",
      type: "boolean",
      sourceId: "some-source",
      read: () => stored,
      write: (_s, v) => {
        stored = v;
      },
      subscribe: () => () => {},
      label: "Sourced",
      category: "Test",
    });
    const def = getSettingDefinition("feat.sourced");
    expect(def?.backing).toBe("source-backed");
    if (def?.backing === "source-backed") {
      expect(def.sourceId).toBe("some-source");
      def.write(null, true);
      expect(def.read(null)).toBe(true);
    }
  });

  it("filters by screen, treating an omitted `screens` as both", () => {
    registerSetting({
      id: "main.only",
      type: "boolean",
      label: "Main only",
      category: "Test",
      defaultValue: false,
      screens: ["main"],
    });
    registerSetting({
      id: "both.screens",
      type: "boolean",
      label: "Both",
      category: "Test",
      defaultValue: false,
    });
    expect(getSettingsForScreen("main").map((s) => s.id)).toEqual([
      "main.only",
      "both.screens",
    ]);
    expect(getSettingsForScreen("station").map((s) => s.id)).toEqual([
      "both.screens",
    ]);
  });

  it("registerSetting is idempotent per id (last write wins)", () => {
    registerSetting({
      id: "dupe",
      type: "boolean",
      label: "First",
      category: "Test",
      defaultValue: false,
    });
    registerSetting({
      id: "dupe",
      type: "boolean",
      label: "Second",
      category: "Test",
      defaultValue: true,
    });
    expect(getAllSettings().filter((s) => s.id === "dupe")).toHaveLength(1);
    expect(getSettingDefinition("dupe")?.label).toBe("Second");
  });
});
