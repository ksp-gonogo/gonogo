import type { HeldGrade } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { formatStreamStatus, heldWord } from "./streamStatusWord";

describe("heldWord", () => {
  it("says HELD for a reading that names no grade", () => {
    expect(heldWord(undefined)).toBe("HELD");
  });

  it("says each grade in the word its stream status badge prints", () => {
    const grades: HeldGrade[] = [
      "held",
      "disconnected",
      "last-before-blackout",
      "recorded",
    ];
    for (const grade of grades) {
      expect(heldWord(grade)).toBe(formatStreamStatus(grade));
    }
  });

  it("keeps blackout and recorded apart from a Topic that went quiet", () => {
    expect(heldWord("last-before-blackout")).not.toBe(heldWord("held"));
    expect(heldWord("recorded")).not.toBe(heldWord("held"));
  });
});
