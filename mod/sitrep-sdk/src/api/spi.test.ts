import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestHost, resetTestHost } from "../testing";
import * as barrel from "./index";

/**
 * Phase 0.4 additions — stream SPI, data introspection, the game-host SPI,
 * the map/fog SPI, the Uplink-handle SPI, the settings-tab SPI, and the
 * telemetry-client SPI. Same injected-host contract as every other stateful
 * member (design §4.3 / D-A): fail loud with no host installed, resolve to
 * the injected host's own implementation once one is.
 *
 * The DataSource-author SPI (registerDataSource/getDataSource) that used to
 * have its own describe block here went through a removal (2026-07-18, "zero
 * production consumers"), a same-night reversal once two facade-sealed
 * Uplink clients turned out to still need it (facade-sealing plan §2.1), and
 * a final removal (2026-07-19) once both were migrated onto non-SPI
 * substitutes — see mod/sitrep-sdk/src/api/types.ts's DataSource type-mirror
 * comment for the full history. First-party code that still authors a
 * `DataSource` imports @ksp-gonogo/core's registerDataSource/getDataSource
 * directly; there is nothing left on this facade to gate.
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

  describe("map/fog SPI", () => {
    it("getBody fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.getBody("Kerbin")).toThrow(named);

      const fakeBody = { id: "Kerbin" } as never;
      const getBody = vi.fn().mockReturnValue(fakeBody);
      installTestHost({ getBody });
      expect(barrel.getBody("Kerbin")).toBe(fakeBody);
      expect(getBody).toHaveBeenCalledWith("Kerbin");
    });

    it("getFogRevealSources fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.getFogRevealSources()).toThrow(named);

      const sources = [{ id: "example-uplink:AltimetryHiRes" }] as never;
      const getFogRevealSources = vi.fn().mockReturnValue(sources);
      installTestHost({ getFogRevealSources });
      expect(barrel.getFogRevealSources()).toBe(sources);
    });

    it("onFogRevealSourcesChange fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      const cb = vi.fn();
      expect(() => barrel.onFogRevealSourcesChange(cb)).toThrow(named);

      const unsubscribe = vi.fn();
      const onFogRevealSourcesChange = vi.fn().mockReturnValue(unsubscribe);
      installTestHost({ onFogRevealSourcesChange });
      expect(barrel.onFogRevealSourcesChange(cb)).toBe(unsubscribe);
      expect(onFogRevealSourcesChange).toHaveBeenCalledWith(cb);
    });

    it("useFogMaskCache fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useFogMaskCache()).toThrow(named);

      const fakeCache = { acquire: vi.fn() } as never;
      const useFogMaskCache = vi.fn().mockReturnValue(fakeCache);
      installTestHost({ useFogMaskCache });
      expect(barrel.useFogMaskCache()).toBe(fakeCache);
    });
  });

  describe("Uplink-handle SPI", () => {
    it("registerUplinkHandle fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      const handle = { foo: "bar" };
      expect(() =>
        barrel.registerUplinkHandle("example-uplink", handle),
      ).toThrow(named);

      const registerUplinkHandle = vi.fn();
      installTestHost({ registerUplinkHandle });
      barrel.registerUplinkHandle("example-uplink", handle);
      expect(registerUplinkHandle).toHaveBeenCalledWith(
        "example-uplink",
        handle,
      );
    });

    it("getUplinkHandle fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.getUplinkHandle("example-uplink")).toThrow(named);

      const handle = { foo: "bar" };
      const getUplinkHandle = vi.fn().mockReturnValue(handle);
      installTestHost({ getUplinkHandle });
      expect(barrel.getUplinkHandle("example-uplink")).toBe(handle);
      expect(getUplinkHandle).toHaveBeenCalledWith("example-uplink");
    });
  });

  describe("settings-tab SPI", () => {
    it("registerSettingsTab fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      const def = {
        id: "example-uplink",
        label: "Example Uplink",
        component: () => null,
      };
      expect(() => barrel.registerSettingsTab(def)).toThrow(named);

      const registerSettingsTab = vi.fn();
      installTestHost({ registerSettingsTab });
      barrel.registerSettingsTab(def);
      expect(registerSettingsTab).toHaveBeenCalledWith(def);
    });
  });

  describe("telemetry-client SPI", () => {
    it("getActiveTelemetryClient fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.getActiveTelemetryClient()).toThrow(named);

      const fakeClient = { subscribe: vi.fn() } as never;
      const getActiveTelemetryClient = vi.fn().mockReturnValue(fakeClient);
      installTestHost({ getActiveTelemetryClient });
      expect(barrel.getActiveTelemetryClient()).toBe(fakeClient);
    });

    it("useTelemetryClientOptional fails LOUD with no host, resolves once installed", () => {
      resetTestHost();
      expect(() => barrel.useTelemetryClientOptional()).toThrow(named);

      const fakeClient = { subscribe: vi.fn() } as never;
      const useTelemetryClientOptional = vi.fn().mockReturnValue(fakeClient);
      installTestHost({ useTelemetryClientOptional });
      expect(barrel.useTelemetryClientOptional()).toBe(fakeClient);
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

  describe("LocalStorageStore — stateless class, no host needed on the happy path", () => {
    function fakeStorage(): Storage {
      const store = new Map<string, string>();
      return {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => store.clear(),
        key: () => null,
        get length() {
          return store.size;
        },
      } as Storage;
    }

    it("get/set/patch/clear round-trip with an injected Storage — no host dependency", () => {
      resetTestHost();
      const store = new barrel.LocalStorageStore({
        key: "test.widget",
        defaults: { enabled: true, count: 0 },
        storage: fakeStorage(),
      });
      expect(store.get()).toEqual({ enabled: true, count: 0 });
      store.set({ enabled: false, count: 3 });
      expect(store.get()).toEqual({ enabled: false, count: 3 });
      store.patch({ count: 5 });
      expect(store.get()).toEqual({ enabled: false, count: 5 });
      store.clear();
      expect(store.get()).toEqual({ enabled: true, count: 0 });
    });

    it("the DEFAULT corruption logger only touches the host when corruption is actually hit", () => {
      resetTestHost();
      const storage = fakeStorage();
      storage.setItem("test.widget", "{not json");
      const store = new barrel.LocalStorageStore({
        key: "test.widget",
        defaults: { enabled: true },
        storage,
      });
      // Fails loud rather than silently logging to a dead console-only
      // logger — same reasoning as the `logger` Proxy shim in ./index.ts.
      expect(() => store.get()).toThrow(named);

      const warn = vi.fn();
      installTestHost({ logger: { tag: () => ({ warn }) } as never });
      expect(store.get()).toEqual({ enabled: true });
      expect(warn).toHaveBeenCalled();
    });
  });
});
