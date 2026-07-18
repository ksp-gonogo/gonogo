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
    registerFogRevealSource({
      id: "example-uplink:AltimetryHiRes",
      weight: 255,
    });
    expect(getFogRevealSources()).toEqual([
      { id: "example-uplink:AltimetryHiRes", weight: 255 },
    ]);
  });

  it("lists sources in registration order", () => {
    registerFogRevealSource({ id: "example-uplink:AltimetryLoRes" });
    registerFogRevealSource({ id: "example-uplink:AltimetryHiRes" });
    expect(getFogRevealSources().map((s) => s.id)).toEqual([
      "example-uplink:AltimetryLoRes",
      "example-uplink:AltimetryHiRes",
    ]);
  });

  it("notifies subscribers on register and unregister, not after unsubscribe", () => {
    const seen: number[] = [];
    const unsub = onFogRevealSourcesChange(() => seen.push(1));
    registerFogRevealSource({ id: "example-uplink:Biome" });
    expect(seen).toHaveLength(1);
    unsub();
    registerFogRevealSource({ id: "example-uplink:ResourceLoRes" });
    expect(seen).toHaveLength(1);
  });

  it("unregisterFogRevealSource removes one source and notifies", () => {
    registerFogRevealSource({ id: "example-uplink:Biome" });
    registerFogRevealSource({ id: "example-uplink:AltimetryHiRes" });
    let notified = false;
    onFogRevealSourcesChange(() => {
      notified = true;
    });
    unregisterFogRevealSource("example-uplink:Biome");
    expect(getFogRevealSources().map((s) => s.id)).toEqual([
      "example-uplink:AltimetryHiRes",
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
      id: "example-uplink:AltimetryHiRes",
      settings: [{ key: "show", type: "boolean", default: true }],
    });
    registerFogRevealSource({ id: "example-uplink:Biome" }); // no settings — excluded
    expect(getFogRevealSourceSettings()).toEqual([
      {
        augmentId: "example-uplink:AltimetryHiRes",
        namespace: "example-uplink:AltimetryHiRes",
        fields: [{ key: "show", type: "boolean", default: true }],
      },
    ]);
  });

  it("clearFogRevealSources resets the registry", () => {
    registerFogRevealSource({ id: "example-uplink:Biome" });
    clearFogRevealSources();
    expect(getFogRevealSources()).toEqual([]);
  });
});
