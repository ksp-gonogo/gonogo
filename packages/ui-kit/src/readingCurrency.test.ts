import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { resolveCurrency } from "./readingCurrency";

describe("resolveCurrency", () => {
  it("has nothing to say about a held reading that carries no number", () => {
    const resolved = resolveCurrency({
      state: "stale",
      reckoning: { status: "none" },
      asOfUt: value("ut", 1_000),
      grade: "held-stale",
    });
    expect(resolved.notCurrent).toBe(false);
    expect(resolved.caption).toBeNull();
  });

  it("marks and captions a held reading that carries one", () => {
    const resolved = resolveCurrency({
      state: "stale",
      reckoning: { status: "none" },
      value: value("m", 12),
      asOfUt: value("ut", 1_000),
      grade: "held-stale",
    });
    expect(resolved.notCurrent).toBe(true);
    expect(resolved.caption).toMatch(/^STALE/);
  });
});
