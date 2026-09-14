import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  type KerbalismStormEntry,
  KerbalismStormTargetKind,
} from "../__generated__/contract";
import { deriveStorm } from "./index";

/**
 * The CME derivation on a frame with no view clock.
 *
 * `useViewUt()` is `undefined` with no provider mounted, before the first
 * confirmed sample, and through the resynchronizing state after a rewind, so a
 * clockless frame is ordinary rather than exotic. The widget used to answer it
 * with `magnitudeOr(useViewUt(), 0)`, which measured every CME against UT 0: a
 * storm 80 seconds away reported an ETA of the storm time itself, stated to the
 * second, and a transit bar pinned at its start. Both are claims the save never
 * made, and both are asserted absent below.
 *
 * The two fields that do NOT depend on the clock stay readable in the same
 * frame, which is the point of taking them separately: a missing clock costs
 * the operator the ETA and the progress, not the whole card.
 */

/** A CME in transit: everything the ETA needs except a clock to read it against. */
const INBOUND: KerbalismStormEntry = {
  star: "Kerbol",
  stormState: value("count", 1),
  stormTime: value("ut", 149_569),
  dist: value("m", 13_400_000_000),
  targetKind: KerbalismStormTargetKind.Body,
  targetName: "Kerbin",
};

/** `PreferencesRadiation.Instance.StormEjectionSpeed`, m/s. */
const EJECTION_SPEED = 98_931_511.14;

describe("deriveStorm with no view clock", () => {
  it("withholds the impact ETA rather than measuring the CME against UT 0", () => {
    const derived = deriveStorm(INBOUND, 0, null, EJECTION_SPEED);

    expect(derived.impactEtaSec).toBeNull();
    // The old substitution produced `stormTime - 0`, i.e. the storm time read
    // back as a countdown.
    expect(derived.impactEtaSec).not.toBe(149_569);
  });

  it("withholds transit progress rather than reporting a CME that has not moved", () => {
    const derived = deriveStorm(INBOUND, 0, null, EJECTION_SPEED);

    expect(derived.progressPct).toBeNull();
    // Zero is the specific lie: it says the CME is still at the star.
    expect(derived.progressPct).not.toBe(0);
  });

  it("still reports everything that does not need a clock", () => {
    const derived = deriveStorm(INBOUND, 0, null, EJECTION_SPEED);

    expect(derived.star).toBe("Kerbol");
    expect(derived.state).toBe(1);
    expect(derived.targetName).toBe("Kerbin");
    // Departure is `stormTime` minus transit, so it is knowable without a now.
    expect(derived.departureUt).toBeCloseTo(
      149_569 - 13_400_000_000 / EJECTION_SPEED,
      6,
    );
  });
});

describe("deriveStorm with a view clock", () => {
  const NOW = 149_489;

  it("reads the ETA and the progress off the clock", () => {
    const derived = deriveStorm(INBOUND, 0, NOW, EJECTION_SPEED);

    expect(derived.impactEtaSec).toBe(80);
    expect(derived.progressPct).not.toBeNull();
    expect(derived.progressPct as number).toBeGreaterThan(0);
    expect(derived.progressPct as number).toBeLessThanOrEqual(100);
  });

  it("keeps withholding what the entry itself never carried", () => {
    // No `dist`, so transit cannot be placed even with a clock: the clock fix
    // must not have turned an uncaptured transit into a readable one.
    const noDist: KerbalismStormEntry = { ...INBOUND, dist: undefined };
    const derived = deriveStorm(noDist, 0, NOW, EJECTION_SPEED);

    expect(derived.departureUt).toBeNull();
    expect(derived.progressPct).toBeNull();
    // The ETA needs only `stormTime` and the clock, so it survives.
    expect(derived.impactEtaSec).toBe(80);
  });
});
