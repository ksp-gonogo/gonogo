import { FlightEndReason } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { fromFlightEnded } from "./events";

/**
 * Why a flight ended.
 *
 * `flight.ended` carries `reason` as a `Sitrep.Contract.FlightEndReason`
 * INTEGER (`JsonWriter.AppendFlightEnded`: `AppendInteger(sb, (long)f.Reason)`),
 * and the client tested `typeof p.reason === "string"` before using it. No
 * ordinal is ever a string, so the detail was permanently undefined and the log
 * read "Flight ended" and nothing else, for a recovery and for a crash alike.
 *
 * It failed the way this whole class does: silently, and in the direction where
 * everything looks fine. The one test that covered the shape passed a
 * `reason: "recovered"` string no mod has ever sent, and asserted only the kind
 * and the UT, so it agreed with the bug.
 */
describe("flight-ended reason", () => {
  it("can read the FlightEndReason members at all", () => {
    // Guards the table below: an empty enum would make every case vacuous.
    expect(FlightEndReason.Recovered).toBe(0);
    expect(FlightEndReason.Destroyed).toBe(3);
  });

  for (const [name, ordinal] of Object.entries(FlightEndReason).filter(
    ([, v]) => typeof v === "number",
  ) as [string, number][]) {
    it(`names ${name} (${ordinal}) as the detail`, () => {
      const ev = fromFlightEnded({ ut: 200, reason: ordinal });
      expect(ev).toMatchObject({ kind: "flight-ended", ut: 200 });
      expect(ev?.detail).toBe(name);
    });
  }

  it("says nothing when no reason arrived", () => {
    expect(fromFlightEnded({ ut: 200 })?.detail).toBeUndefined();
  });

  /**
   * An ordinal past the end of the enum is a mod newer than this build. No
   * detail is the honest answer: naming it something would put a cause on the
   * log that nothing reported.
   */
  it("says nothing for an ordinal it cannot name", () => {
    expect(fromFlightEnded({ ut: 200, reason: 99 })?.detail).toBeUndefined();
    expect(fromFlightEnded({ ut: 200, reason: -1 })?.detail).toBeUndefined();
  });
});
