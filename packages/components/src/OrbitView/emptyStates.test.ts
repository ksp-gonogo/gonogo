import type { ReckoningDecline } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { noOrbitSentence } from "./emptyStates";

const decline = (reason: ReckoningDecline["reason"]) =>
  ({ reason }) as ReckoningDecline;

describe("noOrbitSentence", () => {
  it("says no orbital data when nothing declined", () => {
    expect(noOrbitSentence(undefined)).toBe("No orbital data");
  });

  it("names the refused coast for a craft under physics, never a packed or absent orbit", () => {
    const sentence = noOrbitSentence(decline("under-physics"));
    expect(sentence).toBe("No coast under physics");
    expect(sentence).not.toMatch(/packed|osculating/i);
  });

  it("falls back to no orbital data for the other reasons", () => {
    expect(noOrbitSentence(decline("beyond-horizon"))).toBe("No orbital data");
  });
});
