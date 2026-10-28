import { SettingsService } from "@ksp-gonogo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DATA_RATE_SETTING,
  dataRateChoiceOf,
  requestRateUnderChoice,
  syncDataRate,
} from "./dataRate";

function fakeClient() {
  const release = vi.fn();
  const requestRate = vi.fn(() => release);
  return { requestRate, release };
}

describe("data rate choice", () => {
  const stops: Array<() => void> = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });
  const follow = (settings: SettingsService) => {
    const stop = syncDataRate(settings);
    stops.push(stop);
    return stop;
  };

  it("reads anything but faster as normal", () => {
    expect(dataRateChoiceOf("faster")).toBe("faster");
    expect(dataRateChoiceOf("normal")).toBe("normal");
    expect(dataRateChoiceOf(undefined)).toBe("normal");
    expect(dataRateChoiceOf("10")).toBe("normal");
  });

  it("raises no Topic by default", () => {
    follow(new SettingsService(new MemoryStorage()));
    const client = fakeClient();
    requestRateUnderChoice(client, "vessel.flight", "fast");
    expect(client.requestRate).not.toHaveBeenCalled();
  });

  it("asks the mod for the fast tier under Faster", () => {
    const settings = new SettingsService(new MemoryStorage());
    settings.set(DATA_RATE_SETTING, "faster");
    follow(settings);
    const client = fakeClient();
    requestRateUnderChoice(client, "vessel.flight", "fast");
    expect(client.requestRate).toHaveBeenCalledWith("vessel.flight", "fast");
  });

  it("drops a raised rate at once when switched to Normal, and raises it again on Faster", () => {
    const settings = new SettingsService(new MemoryStorage());
    settings.set(DATA_RATE_SETTING, "faster");
    follow(settings);
    const client = fakeClient();
    requestRateUnderChoice(client, "vessel.landing", "fast");
    expect(client.requestRate).toHaveBeenCalledTimes(1);

    settings.set(DATA_RATE_SETTING, "normal");
    expect(client.release).toHaveBeenCalledTimes(1);

    settings.set(DATA_RATE_SETTING, "faster");
    expect(client.requestRate).toHaveBeenCalledTimes(2);
  });

  it("raises a Topic whose widget mounted under Normal when switched to Faster", () => {
    const settings = new SettingsService(new MemoryStorage());
    follow(settings);
    const client = fakeClient();
    requestRateUnderChoice(client, "vessel.flight", "fast");
    expect(client.requestRate).not.toHaveBeenCalled();
    settings.set(DATA_RATE_SETTING, "faster");
    expect(client.requestRate).toHaveBeenCalledTimes(1);
  });

  it("gives its request up once when the widget unmounts, and ignores later switches", () => {
    const settings = new SettingsService(new MemoryStorage());
    settings.set(DATA_RATE_SETTING, "faster");
    follow(settings);
    const client = fakeClient();
    const release = requestRateUnderChoice(client, "vessel.flight", "fast");
    release();
    release();
    expect(client.release).toHaveBeenCalledTimes(1);
    settings.set(DATA_RATE_SETTING, "normal");
    settings.set(DATA_RATE_SETTING, "faster");
    expect(client.requestRate).toHaveBeenCalledTimes(1);
  });

  it("goes back to Normal when the screen stops following the setting", () => {
    const settings = new SettingsService(new MemoryStorage());
    settings.set(DATA_RATE_SETTING, "faster");
    const stop = follow(settings);
    const client = fakeClient();
    requestRateUnderChoice(client, "vessel.flight", "fast");
    stop();
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}
