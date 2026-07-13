import {
  getGameHost,
  resetSettingsForTests,
  seedSetting,
  setSetting,
} from "@ksp-gonogo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bumpSitrepReconnect,
  getSitrepHostConfig,
  getSitrepReconnectNonce,
  getSitrepTransportStatus,
  onSitrepTransportStatusChange,
  reportSitrepTransportStatus,
  resetSitrepRuntimeForTests,
  seedSitrepHost,
  setSitrepHostConfig,
  subscribeSitrepHostConfig,
  subscribeSitrepReconnectNonce,
} from "./sitrepRuntime";

beforeEach(() => {
  localStorage.clear();
  resetSitrepRuntimeForTests();
});

afterEach(() => {
  resetSitrepRuntimeForTests();
  resetSettingsForTests();
  localStorage.clear();
});

describe("sitrepRuntime host = core gameHost", () => {
  it("reads host from core gameHost, port from its own default", () => {
    seedSetting("gameHost", "10.0.0.9");
    expect(getSitrepHostConfig().host).toBe("10.0.0.9");
    expect(getSitrepHostConfig().port).toBe(8090);
  });

  it("setSitrepHostConfig writes host to core and persists port locally", () => {
    setSitrepHostConfig({ host: "my-box", port: 8091 });
    expect(getGameHost()).toBe("my-box");
    expect(getSitrepHostConfig().port).toBe(8091);
  });

  it("notifies host-config subscribers when core gameHost changes", () => {
    const cb = vi.fn();
    const unsub = subscribeSitrepHostConfig(cb);
    setSetting("gameHost", "changed");
    expect(cb).toHaveBeenCalled();
    unsub();
  });

  it("returns a stable snapshot reference across reads that did not change", () => {
    const a = getSitrepHostConfig();
    const b = getSitrepHostConfig();
    expect(a).toBe(b); // useSyncExternalStore identity contract
  });

  it("seedSitrepHost delegates to the core seed layer", () => {
    seedSitrepHost("seeded");
    expect(getGameHost()).toBe("seeded");
  });

  it("notifies host-config subscribers exactly once per setSitrepHostConfig, and not at all for a port-only change on the same host", () => {
    setSetting("gameHost", "box"); // establish current host
    const cb = vi.fn();
    const unsub = subscribeSitrepHostConfig(cb);

    setSitrepHostConfig({ host: "box", port: 8099 }); // port-only, host unchanged
    expect(cb).toHaveBeenCalledTimes(1);

    cb.mockClear();
    setSitrepHostConfig({ host: "newbox", port: 8099 }); // host change
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
  });
});

describe("sitrepRuntime transport status", () => {
  it("defaults to disconnected", () => {
    expect(getSitrepTransportStatus()).toBe("disconnected");
  });

  it("reports changes to subscribers, deduping repeats", () => {
    const cb = vi.fn();
    onSitrepTransportStatusChange(cb);

    reportSitrepTransportStatus("connected");
    expect(getSitrepTransportStatus()).toBe("connected");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith("connected");

    reportSitrepTransportStatus("connected");
    expect(cb).toHaveBeenCalledTimes(1);

    reportSitrepTransportStatus("reconnecting");
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe("sitrepRuntime reconnect nonce", () => {
  it("starts at 0 and increments on bump, notifying subscribers", () => {
    expect(getSitrepReconnectNonce()).toBe(0);
    const cb = vi.fn();
    subscribeSitrepReconnectNonce(cb);

    bumpSitrepReconnect();
    expect(getSitrepReconnectNonce()).toBe(1);
    expect(cb).toHaveBeenCalledTimes(1);

    bumpSitrepReconnect();
    expect(getSitrepReconnectNonce()).toBe(2);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
