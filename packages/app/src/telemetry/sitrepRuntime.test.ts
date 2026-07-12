import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("sitrepRuntime host config", () => {
  it("defaults to localhost:8090 with nothing saved or seeded", () => {
    expect(getSitrepHostConfig()).toEqual({ host: "localhost", port: 8090 });
  });

  it("a seed overrides the default but not a save", () => {
    seedSitrepHost("192.168.1.50");
    expect(getSitrepHostConfig()).toEqual({ host: "192.168.1.50", port: 8090 });

    setSitrepHostConfig({ host: "my-box", port: 9999 });
    expect(getSitrepHostConfig()).toEqual({ host: "my-box", port: 9999 });
  });

  it("a save always wins over a later seed", () => {
    setSitrepHostConfig({ host: "my-box", port: 9999 });
    seedSitrepHost("192.168.1.50");
    expect(getSitrepHostConfig()).toEqual({ host: "my-box", port: 9999 });
  });

  it("a save persists to localStorage; a seed does not", () => {
    seedSitrepHost("192.168.1.50");
    expect(localStorage.getItem("gonogo.datasource.sitrep")).toBeNull();

    setSitrepHostConfig({ host: "my-box", port: 9999 });
    expect(localStorage.getItem("gonogo.datasource.sitrep")).not.toBeNull();
  });

  it("notifies subscribers on both save and seed", () => {
    const cb = vi.fn();
    const unsub = subscribeSitrepHostConfig(cb);

    seedSitrepHost("192.168.1.50");
    expect(cb).toHaveBeenCalledTimes(1);

    setSitrepHostConfig({ host: "my-box", port: 9999 });
    expect(cb).toHaveBeenCalledTimes(2);

    unsub();
    setSitrepHostConfig({ host: "other-box", port: 1 });
    expect(cb).toHaveBeenCalledTimes(2);
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
