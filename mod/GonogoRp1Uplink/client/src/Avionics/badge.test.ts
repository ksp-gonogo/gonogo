import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { avionicsBadges } from "./badge";

/**
 * The Navball's avionics badge.
 *
 * The reason it exists is the reason most of these cases are about SILENCE: the
 * badge is the only persistent surface for a loss of control the stock flag
 * cannot see, so what it says has to be a claim, and what it does not say has to
 * be reliably nothing.
 */
describe("avionicsBadges", () => {
  it("draws nothing for a vessel RP-1 has cleared", () => {
    expect(
      avionicsBadges({
        lockLevel: "Unlocked",
        supportedMassTons: value("t", 5),
        vesselMassTons: value("t", 2),
      }),
    ).toBeNull();
  });

  /**
   * A badge is a claim, and an absent channel is not one. Outside flight and the
   * editor RP-1 does not evaluate the rule at all, so nothing was weighed and
   * nothing may be said: an empty header here must not be readable as a craft
   * that has been cleared.
   */
  it("draws nothing when nothing was read", () => {
    expect(avionicsBadges(undefined)).toBeNull();
    expect(avionicsBadges({})).toBeNull();
  });

  /** A level this build does not recognise is not a verdict to badge. */
  it("draws nothing for a level it does not recognise", () => {
    expect(avionicsBadges({ lockLevel: "Suspended" })).toBeNull();
  });

  it("alerts when the controls are locked", () => {
    expect(
      avionicsBadges({
        lockLevel: "Locked",
        supportedMassTons: value("t", 1.5),
        vesselMassTons: value("t", 2.3),
      }),
    ).toEqual([{ id: "rp1-avionics-lock", label: "No control", tone: "nogo" }]);
  });

  /**
   * Axial is the state a boolean could not express, and the wording is the whole
   * point of keeping it: the operator still has roll, so the badge must not tell
   * them they have nothing. Caution rather than alert for the same reason.
   */
  it("cautions in its own words when only roll is left", () => {
    expect(
      avionicsBadges({
        lockLevel: "Axial",
        supportedMassTons: value("t", 12),
        vesselMassTons: value("t", 30),
      }),
    ).toEqual([{ id: "rp1-avionics-lock", label: "Roll only", tone: "warn" }]);
  });

  /**
   * The width invariant, asserted here rather than left to a render to discover.
   *
   * `Panel`'s header aside collapses on a MEASURED fit, so a second pill at the
   * Navball's default width takes the whole row behind a chevron: the alert, and
   * the widget's own SAS and RCS badges with it. Measured at 8x11, not assumed.
   * A detail that hides the alert it qualifies is worth less than nothing on a
   * launch-safety readout, which is why the overage and the near-Earth limit
   * stay on `rp1.avionics` and off the badge.
   */
  it("emits exactly one badge, whatever else the reading carries", () => {
    expect(
      avionicsBadges({
        lockLevel: "Locked",
        supportedMassTons: value("t", 1),
        vesselMassTons: value("t", 4),
        limitedByNonInterplanetary: true,
      }),
    ).toHaveLength(1);
    expect(
      avionicsBadges({
        lockLevel: "Axial",
        limitedByNonInterplanetary: true,
      }),
    ).toHaveLength(1);
  });

  /**
   * The verdict is RP-1's whole answer, so it stands on its own: a reading whose
   * masses did not come back still says what RP-1 decided.
   */
  it("states the verdict even when neither mass was read", () => {
    expect(avionicsBadges({ lockLevel: "Locked" })).toEqual([
      { id: "rp1-avionics-lock", label: "No control", tone: "nogo" },
    ]);
  });
});
