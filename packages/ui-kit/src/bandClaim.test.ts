import type { BandKind } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { bandClaim } from "./bandClaim";

/**
 * The one statement every band-carrying surface speaks, asserted here so the
 * surfaces themselves assert only that they reached it.
 *
 * A hard bound and a one-sigma interval read the same sentence, and neither
 * may reach for the statistics vocabulary a listener cannot be assumed to
 * have.
 */
describe("bandClaim", () => {
  const INTERVAL = "with bands at 30 percent and 44 percent";

  it("leaves the claim alone, because containment needs no qualifier", () => {
    expect(bandClaim("bound", INTERVAL)).toBe(INTERVAL);
  });

  it("reads a sigma1 band the same as a hard bound", () => {
    expect(bandClaim("sigma1", INTERVAL)).toBe(bandClaim("bound", INTERVAL));
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

  it("says nothing about how often the claim holds", () => {
    const kinds: BandKind[] = ["bound", "sigma1"];
    for (const kind of kinds) {
      expect(bandClaim(kind, INTERVAL)).not.toMatch(
        /could be|two thirds|the time/i,
      );
    }
  });
});
