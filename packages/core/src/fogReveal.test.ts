import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFogRevealSources,
  getFogRevealSourceSettings,
  getFogRevealSources,
  onFogRevealSourcesChange,
  registerFogRevealSource,
  unregisterFogRevealSource,
} from "./fogReveal";

beforeEach(() => clearFogRevealSources());

describe("fog reveal source registry", () => {
  it("registers and lists a reveal source", () => {
    registerFogRevealSource({ id: "scansat:AltimetryHiRes", weight: 255 });
    expect(getFogRevealSources()).toEqual([
      { id: "scansat:AltimetryHiRes", weight: 255 },
    ]);
  });

  it("lists sources in registration order", () => {
    registerFogRevealSource({ id: "scansat:AltimetryLoRes" });
    registerFogRevealSource({ id: "scansat:AltimetryHiRes" });
    expect(getFogRevealSources().map((s) => s.id)).toEqual([
      "scansat:AltimetryLoRes",
      "scansat:AltimetryHiRes",
    ]);
  });

  it("notifies subscribers on register and unregister, not after unsubscribe", () => {
    const seen: number[] = [];
    const unsub = onFogRevealSourcesChange(() => seen.push(1));
    registerFogRevealSource({ id: "scansat:Biome" });
    expect(seen).toHaveLength(1);
    unsub();
    registerFogRevealSource({ id: "scansat:ResourceLoRes" });
    expect(seen).toHaveLength(1);
  });

  it("unregisterFogRevealSource removes one source and notifies", () => {
    registerFogRevealSource({ id: "scansat:Biome" });
    registerFogRevealSource({ id: "scansat:AltimetryHiRes" });
    let notified = false;
    onFogRevealSourcesChange(() => {
      notified = true;
    });
    unregisterFogRevealSource("scansat:Biome");
    expect(getFogRevealSources().map((s) => s.id)).toEqual([
      "scansat:AltimetryHiRes",
    ]);
    expect(notified).toBe(true);
  });

  it("unregisterFogRevealSource is a no-op (no notify) for an unknown id", () => {
    let notified = false;
    onFogRevealSourcesChange(() => {
      notified = true;
    });
    unregisterFogRevealSource("does-not-exist");
    expect(notified).toBe(false);
  });

  it("collects settings namespaced by source id, ordered like registration", () => {
    registerFogRevealSource({
      id: "scansat:AltimetryHiRes",
      settings: [{ key: "show", type: "boolean", default: true }],
    });
    registerFogRevealSource({ id: "scansat:Biome" }); // no settings — excluded
    expect(getFogRevealSourceSettings()).toEqual([
      {
        augmentId: "scansat:AltimetryHiRes",
        namespace: "scansat:AltimetryHiRes",
        fields: [{ key: "show", type: "boolean", default: true }],
      },
    ]);
  });

  it("clearFogRevealSources resets the registry", () => {
    registerFogRevealSource({ id: "scansat:Biome" });
    clearFogRevealSources();
    expect(getFogRevealSources()).toEqual([]);
  });
});
