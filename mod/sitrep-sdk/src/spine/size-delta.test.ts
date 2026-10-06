import { afterEach, describe, expect, it } from "vitest";
import { clearContributions, registerContribution } from "./contributions";
import { assertSizeDelta } from "./size-delta";

afterEach(() => clearContributions());

describe("assertSizeDelta", () => {
  it("accepts no delta, an empty one, and whole numbers of zero or more", () => {
    expect(() => assertSizeDelta("x", undefined)).not.toThrow();
    expect(() => assertSizeDelta("x", {})).not.toThrow();
    expect(() => assertSizeDelta("x", { w: 0, h: 3 })).not.toThrow();
  });

  it.each([
    [{ w: -1 }, /w.*-1/],
    [{ w: 1.5 }, /w.*1\.5/],
    [{ h: -2 }, /h.*-2/],
    [{ h: Number.NaN }, /h.*NaN/],
    [{ w: Number.POSITIVE_INFINITY }, /w.*Infinity/],
  ])("refuses %j and names the extension", (delta, message) => {
    expect(() => assertSizeDelta("my-ext", delta)).toThrow(/"my-ext"/);
    expect(() => assertSizeDelta("my-ext", delta)).toThrow(message);
  });
});

describe("registerContribution with a sizeDelta", () => {
  const base = {
    id: "c",
    contributes: "some-widget.badges",
    compute: () => null,
  };

  it("refuses a negative or fractional delta and registers nothing", () => {
    expect(() =>
      registerContribution({ ...base, sizeDelta: { w: -1 } } as never),
    ).toThrow(/sizeDelta/);
    expect(() =>
      registerContribution({ ...base, sizeDelta: { w: 1.5 } } as never),
    ).toThrow(/sizeDelta/);
  });

  it("accepts a whole non-negative delta", () => {
    expect(() =>
      registerContribution({ ...base, sizeDelta: { w: 1, h: 2 } } as never),
    ).not.toThrow();
  });
});
