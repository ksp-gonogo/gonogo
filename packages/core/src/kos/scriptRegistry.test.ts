import { afterEach, describe, expect, it } from "vitest";
import {
  clearKosScripts,
  getKosScript,
  getKosScripts,
  registerKosScript,
} from "./scriptRegistry";

const SAMPLE = {
  id: "shipmap",
  name: "Ship Map",
  script: 'PRINT "[KOSDATA:shipmap]parts=[][/KOSDATA]".',
  intervalMs: 2000,
  fields: [{ name: "parts", type: "json" as const }],
};

describe("kos script registry", () => {
  afterEach(() => {
    clearKosScripts();
  });

  it("stores and retrieves a registered script", () => {
    registerKosScript(SAMPLE);
    expect(getKosScript("shipmap")).toEqual(SAMPLE);
    expect(getKosScripts()).toHaveLength(1);
  });

  it("returns undefined for an unknown id", () => {
    expect(getKosScript("nope")).toBeUndefined();
  });

  it("replaces a previous registration with the same id (HMR-friendly)", () => {
    registerKosScript(SAMPLE);
    registerKosScript({ ...SAMPLE, intervalMs: 5000 });
    expect(getKosScripts()).toHaveLength(1);
    expect(getKosScript("shipmap")?.intervalMs).toBe(5000);
  });

  it("rejects an id with characters that break the [KOSDATA:<id>] tag", () => {
    expect(() => registerKosScript({ ...SAMPLE, id: "ship.map" })).toThrow(
      /must match/,
    );
    expect(() => registerKosScript({ ...SAMPLE, id: "ship map" })).toThrow(
      /must match/,
    );
  });

  it("accepts kebab-case and underscores", () => {
    registerKosScript({ ...SAMPLE, id: "fuel-status" });
    registerKosScript({ ...SAMPLE, id: "burn_log" });
    expect(getKosScripts()).toHaveLength(2);
  });

  it("rejects a definition with no fields", () => {
    expect(() => registerKosScript({ ...SAMPLE, fields: [] })).toThrow(
      /at least one field/,
    );
  });

  it("rejects a non-positive intervalMs", () => {
    expect(() => registerKosScript({ ...SAMPLE, intervalMs: 0 })).toThrow(
      /intervalMs/,
    );
    expect(() => registerKosScript({ ...SAMPLE, intervalMs: -100 })).toThrow(
      /intervalMs/,
    );
  });

  it("clearKosScripts empties the registry", () => {
    registerKosScript(SAMPLE);
    clearKosScripts();
    expect(getKosScripts()).toHaveLength(0);
  });
});
