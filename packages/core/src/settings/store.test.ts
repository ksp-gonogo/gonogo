import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSetting,
  resetSettingsForTests,
  seedSetting,
  setSetting,
  subscribeSetting,
} from "./store";

afterEach(() => {
  resetSettingsForTests();
  localStorage.clear();
});

describe("core settings store", () => {
  it("returns undefined for an unset key", () => {
    expect(getSetting("gameHost")).toBeUndefined();
  });

  it("setSetting persists to localStorage and wins on read", () => {
    setSetting("gameHost", "10.0.0.5");
    expect(getSetting("gameHost")).toBe("10.0.0.5");
    const raw = JSON.parse(localStorage.getItem("gonogo.settings") as string);
    expect(raw).toEqual({ version: 1, values: { gameHost: "10.0.0.5" } });
  });

  it("seedSetting is in-memory only and does not persist", () => {
    seedSetting("gameHost", "seed-host");
    expect(getSetting("gameHost")).toBe("seed-host");
    expect(localStorage.getItem("gonogo.settings")).toBeNull();
  });

  it("a saved value wins over a seed", () => {
    seedSetting("gameHost", "seed-host");
    setSetting("gameHost", "saved-host");
    expect(getSetting("gameHost")).toBe("saved-host");
  });

  it("notifies subscribers on save and on seed, only for that key", () => {
    const gameCb = vi.fn();
    const otherCb = vi.fn();
    const unsub = subscribeSetting("gameHost", gameCb);
    subscribeSetting("relayUrl", otherCb);

    setSetting("gameHost", "a");
    seedSetting("gameHost", "b");
    expect(gameCb).toHaveBeenCalledTimes(2);
    expect(otherCb).not.toHaveBeenCalled();

    unsub();
    setSetting("gameHost", "c");
    expect(gameCb).toHaveBeenCalledTimes(2);
  });

  it("hydrates a saved value written before this module read it", () => {
    localStorage.setItem(
      "gonogo.settings",
      JSON.stringify({ version: 1, values: { gameHost: "from-disk" } }),
    );
    // getSetting reads through to localStorage for the saved layer.
    expect(getSetting("gameHost")).toBe("from-disk");
  });
});
