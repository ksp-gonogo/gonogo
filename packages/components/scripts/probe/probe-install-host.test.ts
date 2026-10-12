import { getSettingDefinition } from "@ksp-gonogo/core";
import { registerSetting } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import "./probe-install-host";

describe("the probe host", () => {
  it("registers a setting an example declares through the sdk", () => {
    registerSetting({
      id: "probe-host-setting",
      label: "Probe host setting",
      category: "Probe",
      defaultValue: true,
    });

    expect(getSettingDefinition("probe-host-setting")?.label).toBe(
      "Probe host setting",
    );
  });
});
