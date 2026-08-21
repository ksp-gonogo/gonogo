import { GameMode } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { GAME_MODE_ORDINAL } from "./useGameContext";

/**
 * `career.mode.mode` is a `Sitrep.Contract.GameMode` ORDINAL on the wire, and
 * `GAME_MODE_ORDINAL` is the table that turns it back into a mode string.
 *
 * A table shorter than its enum does not throw: the ordinal indexes off the
 * end, the `?? "Unknown"` fallback catches it, and a real career game reads as
 * a mode nobody can name. `chargesFunds` and `isCareerLike` hang off that
 * string, so the cost is a dashboard that stops knowing whether the player is
 * spending money.
 *
 * The equivalent tables in the SDK spine are derived from the generated enums
 * and cannot drift. This one carries its own casing, which is why it is still
 * written out, and why it is checked here instead.
 */

/** Enum member names in ordinal order, off the generated enum's reverse map. */
function declaredModes(): string[] {
  return Object.entries(GameMode)
    .filter(([key]) => Number.isInteger(Number(key)))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, name]) => String(name));
}

describe("GAME_MODE_ORDINAL", () => {
  it("can read the GameMode members at all", () => {
    // Guards the guard: an extractor returning nothing would let any table
    // through and report success for the drift it was asked about.
    expect(declaredModes()).toEqual([
      "Sandbox",
      "Career",
      "Science",
      "Unknown",
    ]);
  });

  it("carries an entry for every member, in ordinal order", () => {
    // Compared case-insensitively: the table shouts every mode except Unknown,
    // which is a display convention rather than a second source of truth about
    // which modes exist.
    expect(GAME_MODE_ORDINAL.map((m) => m.toLowerCase())).toEqual(
      declaredModes().map((m) => m.toLowerCase()),
    );
  });

  it("resolves the last member rather than falling off the end", () => {
    const last = declaredModes().length - 1;
    expect(GAME_MODE_ORDINAL[last]).toBeDefined();
  });
});
