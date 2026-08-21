import { isValue, value } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  __clearSettingsForTests,
  getAllSettings,
  getSettingDefinition,
  getSettingsForScreen,
  isReadOnlySetting,
  registerSetting,
  settingTypeOf,
} from "./registry";

afterEach(() => {
  __clearSettingsForTests();
});

describe("settings registry: three backings", () => {
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
    // narrows to ClientPrefSetting: defaultValue is present
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
      // A writable row HAS a write half: `write` is optional now, because a
      // read-only source-backed row omits it, so the presence is the assertion.
      expect(def.write).toBeDefined();
      def.write?.(null, true);
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

describe("settings registry: read-only, typed and grouped rows", () => {
  it("keeps a row with no `type` a boolean, the way every row was declared before there was a choice", () => {
    registerSetting({
      id: "legacy.implicit",
      label: "Implicit",
      category: "Test",
      defaultValue: true,
    });
    const def = getSettingDefinition("legacy.implicit");
    expect(def?.type).toBeUndefined();
    // The renderer never reads `type` raw, so an omitted one is a boolean
    // everywhere it matters.
    expect(def && settingTypeOf(def)).toBe("boolean");
  });

  it("stores a stream-backed row with its topic and selector", () => {
    registerSetting({
      id: "example.frame",
      backing: "stream-backed",
      type: "text",
      topic: "example.settings",
      select: (p) => (p as { frameName: string }).frameName,
      label: "Selected frame",
      category: "Example",
      group: "Plotting frame",
    });
    const def = getSettingDefinition("example.frame");
    expect(def?.backing).toBe("stream-backed");
    if (def?.backing === "stream-backed") {
      expect(def.topic).toBe("example.settings");
      expect(def.select({ frameName: "Kerbin-centred" })).toBe(
        "Kerbin-centred",
      );
    }
    expect(def?.group).toBe("Plotting frame");
  });

  it("carries a quantity through a number row, unit and all", () => {
    registerSetting({
      id: "example.tolerance",
      backing: "stream-backed",
      type: "number",
      topic: "example.settings",
      select: (p) => value("m", (p as { tolerance: number }).tolerance),
      label: "Prediction tolerance",
      category: "Example",
    });
    const def = getSettingDefinition("example.tolerance");
    const carried =
      def?.backing === "stream-backed" ? def.select({ tolerance: 1 }) : null;
    // The row hands the renderer a Value, so `Unit` decides the symbol and the
    // spoken word. A bare 1 would render a tolerance with no dimension at all.
    expect(isValue(carried)).toBe(true);
  });
});

describe("isReadOnlySetting: one rule for two ways of having no writer", () => {
  it("says so when the row declares it", () => {
    registerSetting({
      id: "ro.declared",
      backing: "source-backed",
      type: "text",
      readOnly: true,
      sourceId: "src",
      read: () => "1.4.2",
      subscribe: () => () => {},
      label: "Build",
      category: "Test",
    });
    const def = getSettingDefinition("ro.declared");
    expect(def && isReadOnlySetting(def)).toBe(true);
  });

  it("says so for a stream-backed row, which never had a writer to declare", () => {
    registerSetting({
      id: "ro.stream",
      backing: "stream-backed",
      type: "text",
      topic: "example.settings",
      select: () => "x",
      label: "Frame",
      category: "Test",
    });
    const def = getSettingDefinition("ro.stream");
    // The flag is absent and the answer is still yes. A renderer that checked
    // only the flag would offer a Switch over a telemetry topic.
    expect(def?.readOnly).toBeUndefined();
    expect(def && isReadOnlySetting(def)).toBe(true);
  });

  it("says so for a source-backed row whose binding has no write half", () => {
    registerSetting({
      id: "ro.noWriter",
      backing: "source-backed",
      type: "text",
      sourceId: "src",
      read: () => "1.4.2",
      subscribe: () => () => {},
      label: "Build",
      category: "Test",
    });
    const def = getSettingDefinition("ro.noWriter");
    expect(def && isReadOnlySetting(def)).toBe(true);
  });

  it("says no for the ordinary writable row", () => {
    registerSetting({
      id: "rw.pref",
      type: "boolean",
      label: "Pref",
      category: "Test",
      defaultValue: true,
    });
    const def = getSettingDefinition("rw.pref");
    expect(def && isReadOnlySetting(def)).toBe(false);
  });
});
