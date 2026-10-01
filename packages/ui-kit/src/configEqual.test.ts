import { describe, expect, it } from "vitest";
import { configEqual } from "./configEqual";

describe("configEqual", () => {
  it("ignores key order and undefined keys", () => {
    expect(configEqual({ a: 1, b: undefined }, { c: undefined, a: 1 })).toBe(
      true,
    );
    expect(configEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("compares dates by time", () => {
    expect(configEqual(new Date(5), new Date(5))).toBe(true);
    expect(configEqual(new Date(5), new Date(6))).toBe(false);
    expect(configEqual(new Date(5), {})).toBe(false);
  });

  it("compares sets by membership", () => {
    expect(configEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(configEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false);
    expect(configEqual(new Set([1]), new Set([1, 2]))).toBe(false);
    expect(configEqual(new Set([{ a: 1 }]), new Set([{ a: 1 }]))).toBe(true);
    expect(configEqual(new Set(), [])).toBe(false);
  });

  it("compares maps by entries", () => {
    expect(configEqual(new Map([["a", 1]]), new Map([["a", 1]]))).toBe(true);
    expect(configEqual(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false);
    expect(configEqual(new Map([["a", 1]]), new Map([["b", 1]]))).toBe(false);
    expect(configEqual(new Map(), new Set())).toBe(false);
    expect(
      configEqual(new Map([["a", { x: 1 }]]), new Map([["a", { x: 1 }]])),
    ).toBe(true);
  });

  it("finds a Map nested in an object", () => {
    expect(
      configEqual({ m: new Map([["a", 1]]) }, { m: new Map([["a", 2]]) }),
    ).toBe(false);
  });
});
