import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestHost, resetTestHost } from "../testing";
import * as barrel from "./index";

/**
 * Phase 0.4 additions — stream SPI, data introspection, and the game-host
 * SPI. Same injected-host contract as every other stateful member (design
 * §4.3 / D-A): fail loud with no host installed, resolve to the injected
 * host's own implementation once one is. The DataSource-author SPI
 * (registerDataSource/getDataSource) that used to live here was removed
 * (kos migration, 2026-07-18) — it had zero production consumers
 * independent of kos, and first-party code always imports
 * @ksp-gonogo/core's registerDataSource/getDataSource directly rather than
 * through this facade.
 */
describe("sitrep-sdk author-facing barrel — SPI gap shims", () => {
  afterEach(() => {
    resetTestHost();
  });

  const named =
    /@ksp-gonogo\/sitrep-sdk: the gonogo host has not been installed/;

  describe("stream SPI", () => {
    it("useLatestValue fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useLatestValue("comms.delay")).toThrow(named);

      const useLatestValue = vi.fn().mockReturnValue(42);
      installTestHost({ useLatestValue });
      expect(barrel.useLatestValue<number>("comms.delay")).toBe(42);
      expect(useLatestValue).toHaveBeenCalledWith("comms.delay");
    });

    it("useStreamEvent fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      const handler = vi.fn();
      expect(() => barrel.useStreamEvent("crash.lastCrash", handler)).toThrow(
        named,
      );

      const useStreamEvent = vi.fn();
      installTestHost({ useStreamEvent });
      barrel.useStreamEvent("crash.lastCrash", handler);
      expect(useStreamEvent).toHaveBeenCalledWith("crash.lastCrash", handler);
    });

    it("useUtNow fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useUtNow()).toThrow(named);

      const useUtNow = vi.fn().mockReturnValue(123.5);
      installTestHost({ useUtNow });
      expect(barrel.useUtNow()).toBe(123.5);
    });

    it("useTelemetryStoreOptional fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useTelemetryStoreOptional()).toThrow(named);

      const fakeStore = { currentFrame: vi.fn() };
      const useTelemetryStoreOptional = vi.fn().mockReturnValue(fakeStore);
      installTestHost({ useTelemetryStoreOptional });
      expect(barrel.useTelemetryStoreOptional()).toBe(fakeStore);
    });

    it("useViewClockOptional fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useViewClockOptional()).toThrow(named);

      const fakeClock = { confirmedEdgeUt: vi.fn() };
      const useViewClockOptional = vi.fn().mockReturnValue(fakeClock);
      installTestHost({ useViewClockOptional });
      expect(barrel.useViewClockOptional()).toBe(fakeClock);
    });
  });

  describe("data introspection", () => {
    it("useDataSchema fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useDataSchema("kos")).toThrow(named);

      const schema = [{ key: "widget.example.value", label: "X" }];
      const useDataSchema = vi.fn().mockReturnValue(schema);
      installTestHost({ useDataSchema });
      expect(barrel.useDataSchema("kos")).toBe(schema);
      expect(useDataSchema).toHaveBeenCalledWith("kos");
    });

    it("useReplaySessionActive fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useReplaySessionActive()).toThrow(named);

      const useReplaySessionActive = vi.fn().mockReturnValue(true);
      installTestHost({ useReplaySessionActive });
      expect(barrel.useReplaySessionActive()).toBe(true);
    });
  });

  describe("game-host SPI", () => {
    it("getGameHost fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.getGameHost()).toThrow(named);

      const getGameHost = vi.fn().mockReturnValue("192.168.1.50");
      installTestHost({ getGameHost });
      expect(barrel.getGameHost()).toBe("192.168.1.50");
    });

    it("subscribeSetting fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      const cb = vi.fn();
      expect(() => barrel.subscribeSetting("gameHost", cb)).toThrow(named);

      const unsubscribe = vi.fn();
      const subscribeSetting = vi.fn().mockReturnValue(unsubscribe);
      installTestHost({ subscribeSetting });
      expect(barrel.subscribeSetting("gameHost", cb)).toBe(unsubscribe);
      expect(subscribeSetting).toHaveBeenCalledWith("gameHost", cb);
    });
  });

  it("GAME_HOST_KEY is the stable settings key, never gated by the host", () => {
    expect(barrel.GAME_HOST_KEY).toBe("gameHost");
  });

  it("safeRandomUuid is a stateless util — no host needed, produces distinct v4 UUIDs", () => {
    resetTestHost();
    const a = barrel.safeRandomUuid();
    const b = barrel.safeRandomUuid();
    const v4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(a).toMatch(v4);
    expect(b).toMatch(v4);
    expect(a).not.toBe(b);
  });
});
