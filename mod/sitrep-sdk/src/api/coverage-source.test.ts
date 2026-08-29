import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCoverageSources,
  getCoverageSourceSettings,
  getCoverageSources,
  onCoverageSourcesChange,
  registerCoverageSource,
  unregisterCoverageSource,
} from "./coverage-source";

beforeEach(() => clearCoverageSources());

describe("coverage source registry", () => {
  it("registers and lists a coverage source", () => {
    registerCoverageSource({
      id: "example-uplink:AltimetryHiRes",
      weight: 255,
    });
    expect(getCoverageSources()).toEqual([
      { id: "example-uplink:AltimetryHiRes", weight: 255 },
    ]);
  });

  it("lists sources in registration order", () => {
    registerCoverageSource({ id: "example-uplink:AltimetryLoRes" });
    registerCoverageSource({ id: "example-uplink:AltimetryHiRes" });
    expect(getCoverageSources().map((s) => s.id)).toEqual([
      "example-uplink:AltimetryLoRes",
      "example-uplink:AltimetryHiRes",
    ]);
  });

  it("notifies subscribers on register and unregister, not after unsubscribe", () => {
    const seen: number[] = [];
    const unsub = onCoverageSourcesChange(() => seen.push(1));
    registerCoverageSource({ id: "example-uplink:Biome" });
    expect(seen).toHaveLength(1);
    unsub();
    registerCoverageSource({ id: "example-uplink:ResourceLoRes" });
    expect(seen).toHaveLength(1);
  });

  it("unregisterCoverageSource removes one source and notifies", () => {
    registerCoverageSource({ id: "example-uplink:Biome" });
    registerCoverageSource({ id: "example-uplink:AltimetryHiRes" });
    let notified = false;
    onCoverageSourcesChange(() => {
      notified = true;
    });
    unregisterCoverageSource("example-uplink:Biome");
    expect(getCoverageSources().map((s) => s.id)).toEqual([
      "example-uplink:AltimetryHiRes",
    ]);
    expect(notified).toBe(true);
  });

  it("unregisterCoverageSource is a no-op (no notify) for an unknown id", () => {
    let notified = false;
    onCoverageSourcesChange(() => {
      notified = true;
    });
    unregisterCoverageSource("does-not-exist");
    expect(notified).toBe(false);
  });

  it("collects settings namespaced by source id, ordered like registration", () => {
    registerCoverageSource({
      id: "example-uplink:AltimetryHiRes",
      settings: [{ key: "show", type: "boolean", default: true }],
    });
    registerCoverageSource({ id: "example-uplink:Biome" }); // no settings, excluded
    expect(getCoverageSourceSettings()).toEqual([
      {
        augmentId: "example-uplink:AltimetryHiRes",
        namespace: "example-uplink:AltimetryHiRes",
        fields: [{ key: "show", type: "boolean", default: true }],
      },
    ]);
  });

  it("clearCoverageSources resets the registry", () => {
    registerCoverageSource({ id: "example-uplink:Biome" });
    clearCoverageSources();
    expect(getCoverageSources()).toEqual([]);
  });
});
