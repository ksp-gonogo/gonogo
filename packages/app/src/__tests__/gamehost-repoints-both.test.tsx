import {
  getGameHost,
  resetSettingsForTests,
  setSetting,
} from "@ksp-gonogo/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  getSitrepHostConfig,
  resetSitrepRuntimeForTests,
} from "../telemetry/sitrepRuntime";

afterEach(() => {
  resetSitrepRuntimeForTests();
  resetSettingsForTests();
  localStorage.clear();
});

describe("editing the shared gameHost repoints every Uplink", () => {
  it("moves the telemetry stream host", () => {
    setSetting("gameHost", "192.168.9.9");
    expect(getSitrepHostConfig().host).toBe("192.168.9.9");
    expect(getSitrepHostConfig().port).toBe(8090); // port unchanged
  });

  it("proves the two used to diverge: a single value now feeds both", () => {
    setSetting("gameHost", "unified");
    expect(getGameHost()).toBe("unified");
    expect(getSitrepHostConfig().host).toBe("unified");
  });
});
