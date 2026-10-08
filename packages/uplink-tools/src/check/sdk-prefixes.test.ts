import { describe, expect, it } from "vitest";
import { sdkDynamicPrefixes } from "./sdk-prefixes";

describe("sdkDynamicPrefixes", () => {
  it("reads the prefixes the installed sdk registers", () => {
    const { prefixes } = sdkDynamicPrefixes(import.meta.dirname);
    expect(prefixes).toContain("fleet.");
    expect(prefixes).toContain("vessel.partActions.");
  });

  it("names the problem when no sdk is installed", () => {
    const found = sdkDynamicPrefixes("/");
    expect(found.prefixes).toEqual([]);
    expect(found.problem).toMatch(/not installed/);
  });
});
