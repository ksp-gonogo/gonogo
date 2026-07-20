import { describe, expect, it } from "vitest";
import { shouldSuppressVanillaBase } from "./vanillaSuppression";

// Regression guard (2026-07-20): a `map-view.base` augment's presence in the
// REGISTRY is not the same as its Domain being LIVE — the client bundle that
// registers an augment (e.g. via an unconditional `import "@ksp-gonogo/..."`
// in the app's entry point) always registers it, whether or not the mod is
// actually running in KSP. Suppressing the vanilla base purely off registry
// presence means every user without the mod installed gets a black map with
// nothing to draw on it. Suppression must therefore respect the SAME
// availability signal `AugmentSlot` uses to decide whether to render an
// augment's own component at all (see `useAugmentAvailable`,
// packages/core/src/AugmentSlot.tsx) — "don't like it, don't have the
// Uplink" means the Domain is live, not merely that the bundle exists.

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
