import { afterEach, describe, expect, it } from "vitest";
import { getGameHost } from "./gameHost";
import { resetSettingsForTests, seedSetting, setSetting } from "./store";

afterEach(() => {
  resetSettingsForTests();
  localStorage.clear();
});

describe("getGameHost", () => {
  it("falls back to localhost when nothing is set (no VITE_SITREP_HOST in test env)", () => {
    expect(getGameHost()).toBe("localhost");
  });

  it("returns a seeded host", () => {
    seedSetting("gameHost", "192.168.1.50");
    expect(getGameHost()).toBe("192.168.1.50");
  });

  it("returns a saved host over a seed", () => {
    seedSetting("gameHost", "seed-host");
    setSetting("gameHost", "saved-host");
    expect(getGameHost()).toBe("saved-host");
  });
});
