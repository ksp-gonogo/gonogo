import { getGameHost, resetSettingsForTests } from "@ksp-gonogo/core";
import { SettingsService } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { sitrepStreamSource } from "../dataSources/sitrep";
import { resetSitrepRuntimeForTests } from "./sitrepRuntime";

afterEach(() => {
  resetSitrepRuntimeForTests();
  resetSettingsForTests();
  localStorage.clear();
});

describe("a saved Sitrep Stream host", () => {
  it("survives a later change to any other client setting", () => {
    const service = new SettingsService();
    sitrepStreamSource.configure({ host: "192.0.2.45", port: 8090 });

    service.set("time.realCalendarDates", false);
    service.flush();

    expect(getGameHost()).toBe("192.0.2.45");
    service.dispose();
  });

  it("survives a client setting saved before the host was", () => {
    const service = new SettingsService();
    service.set("time.realCalendarDates", false);
    service.flush();

    sitrepStreamSource.configure({ host: "192.0.2.45", port: 8090 });
    service.set("another.setting", 1);
    service.flush();

    expect(getGameHost()).toBe("192.0.2.45");
    expect(new SettingsService().get("time.realCalendarDates", true)).toBe(
      false,
    );
    service.dispose();
  });
});
