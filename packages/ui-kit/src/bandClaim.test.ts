import type { BandKind } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { bandClaim } from "./bandClaim";

/**
 * The one statement every band-carrying surface speaks, asserted here so the
 * surfaces themselves assert only that they reached it.
 *
 * The three properties pull against each other, which is why they are written
 * down: a hard bound has to stay the stronger claim, a one-sigma interval has
 * to stay audibly weaker, and neither may reach for the statistics vocabulary
 * a listener cannot be assumed to have.
 */
describe("bandClaim", () => {
  const INTERVAL = "30 percent to 44 percent";

  it("leaves a hard bound's claim alone, because containment needs no qualifier", () => {
    expect(bandClaim("bound", INTERVAL)).toBe(INTERVAL);
  });

  it("says how often a one-sigma interval holds, rather than leaving it to be taken for a limit", () => {
    const said = bandClaim("sigma1", INTERVAL);
    expect(said).toContain(INTERVAL);
    expect(said).toMatch(/two thirds of the time/i);
  });

  it("keeps the two kinds distinguishable by ear", () => {
    expect(bandClaim("sigma1", INTERVAL)).not.toBe(
      bandClaim("bound", INTERVAL),
    );
  });

  /*
   * The point of the whole helper. "Sigma", "standard deviation" and
   * "confidence interval" are names for the thing rather than statements of
   * what it claims, and a listener who does not already know the statistics
   * learns nothing from any of them.
   */
  it("reaches for no statistics vocabulary in either arm", () => {
    const kinds: BandKind[] = ["bound", "sigma1"];
    for (const kind of kinds) {
      expect(bandClaim(kind, INTERVAL)).not.toMatch(
        /sigma|standard deviation|standard error|confidence interval|variance/i,
      );
    }
  });
});
