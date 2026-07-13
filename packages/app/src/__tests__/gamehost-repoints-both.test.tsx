import {
  getGameHost,
  resetSettingsForTests,
  setSetting,
} from "@ksp-gonogo/core";
import { kerbcastSource } from "@ksp-gonogo/kerbcast-feed";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("moves the kerbcast /offer target", async () => {
    setSetting("gameHost", "192.168.9.9");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sdp: "a", cameras: [] }), {
        status: 200,
      }),
    );
    await kerbcastSource.relayOffer({ sdp: "offer", cameras: [] });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://192.168.9.9:8088/offer",
      expect.anything(),
    );
    fetchSpy.mockRestore();
  });

  it("proves the two used to diverge: a single value now feeds both", () => {
    setSetting("gameHost", "unified");
    expect(getGameHost()).toBe("unified");
    expect(getSitrepHostConfig().host).toBe("unified");
  });
});
