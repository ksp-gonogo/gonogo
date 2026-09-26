import { describe, expect, it } from "vitest";
import { shouldSuppressVanillaBase } from "./vanillaSuppression";

// Registration is not a live Domain (a client bundle always registers its augments), so suppression must respect the same availability signal `AugmentSlot` renders by.

describe("shouldSuppressVanillaBase", () => {
  it("does NOT suppress when the declaring augment's Domain is unavailable (the regression case)", () => {
    expect(
      shouldSuppressVanillaBase([
        { suppressesVanillaBase: true, available: false },
      ]),
    ).toBe(false);
  });

  it("suppresses once the declaring augment's Domain is available", () => {
    expect(
      shouldSuppressVanillaBase([
        { suppressesVanillaBase: true, available: true },
      ]),
    ).toBe(true);
  });

  it("does not suppress for an augment that doesn't declare suppressesVanillaBase, even while available", () => {
    expect(shouldSuppressVanillaBase([{ available: true }])).toBe(false);
  });

  it("suppresses if ANY available candidate suppresses (logical OR, order-independent)", () => {
    expect(
      shouldSuppressVanillaBase([
        { available: true }, // no suppressesVanillaBase
        { suppressesVanillaBase: true, available: false }, // suppresses, but unavailable
        { suppressesVanillaBase: true, available: true }, // the one that matters
      ]),
    ).toBe(true);
  });

  it("returns false for an empty candidate list", () => {
    expect(shouldSuppressVanillaBase([])).toBe(false);
  });
});
