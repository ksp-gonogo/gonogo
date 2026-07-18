import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMapPoiProviders,
  getMapPoiProviders,
  onMapPoiProvidersChange,
  registerMapPoiProvider,
} from "./mapPoi";

beforeEach(() => clearMapPoiProviders());

describe("map POI provider registry", () => {
  it("registers and lists a provider", () => {
    const usePois = () => [];
    registerMapPoiProvider({ id: "vanilla:spaceCenter", usePois });
    expect(getMapPoiProviders()).toEqual([
      { id: "vanilla:spaceCenter", usePois },
    ]);
  });

  it("lists providers in registration order", () => {
    registerMapPoiProvider({ id: "vanilla:spaceCenter", usePois: () => [] });
    registerMapPoiProvider({
      id: "example-uplink:anomalies",
      requires: "example-uplink",
      usePois: () => [],
    });
    expect(getMapPoiProviders().map((p) => p.id)).toEqual([
      "vanilla:spaceCenter",
      "example-uplink:anomalies",
    ]);
  });

  it("notifies subscribers on register, not after unsubscribe", () => {
    let count = 0;
    const unsub = onMapPoiProvidersChange(() => {
      count++;
    });
    registerMapPoiProvider({ id: "vanilla:spaceCenter", usePois: () => [] });
    expect(count).toBe(1);
    unsub();
    registerMapPoiProvider({
      id: "example-uplink:anomalies",
      usePois: () => [],
    });
    expect(count).toBe(1);
  });

  it("clearMapPoiProviders resets the registry", () => {
    registerMapPoiProvider({ id: "vanilla:spaceCenter", usePois: () => [] });
    clearMapPoiProviders();
    expect(getMapPoiProviders()).toEqual([]);
  });
});
