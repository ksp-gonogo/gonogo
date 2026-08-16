import { describe, expect, it } from "vitest";
import {
  contactPhase,
  type FleetVesselSilence,
  overdueSeconds,
} from "./fleet-contact";

const silent = (
  over: Partial<FleetVesselSilence> = {},
): FleetVesselSilence => ({
  state: "Silent",
  silenceSinceUt: 1_000,
  deadlineUt: 4_000,
  deadlineBasis: "predicted-reacquisition",
  predictedReacquisitionUt: 2_000,
  ...over,
});

describe("contactPhase", () => {
  it("is nominal while the vessel is in contact", () => {
    expect(contactPhase({ state: "Nominal" }, 1_500)).toBe("nominal");
  });

  it("is expected while a silent vessel is not yet due back", () => {
    expect(contactPhase(silent(), 1_500)).toBe("expected");
  });

  it("becomes overdue once the predicted emergence has passed", () => {
    expect(contactPhase(silent(), 2_500)).toBe("overdue");
  });

  it("stays overdue rather than lost right up to the deadline", () => {
    // Overdue is a distinct state, not an early form of lost: the operator is
    // told the vessel is late while there is still time for it to appear.
    expect(contactPhase(silent(), 3_999)).toBe("overdue");
  });

  it("is lost once the tracker says so, whatever the prediction said", () => {
    expect(contactPhase(silent({ state: "Lost" }), 2_500)).toBe("lost");
  });

  /**
   * The distinction the whole wire contract is careful about. A missing
   * prediction means one was WITHHELD, so the vessel is quiet with nothing
   * having promised it would be back. Reading the absent number as an emergence
   * of "now" would report every such vessel as overdue the instant it went
   * quiet, which is the alarm-generator failure in client form.
   */
  it("is waiting, never overdue, when no prediction was made", () => {
    for (const basis of [
      "no-occultation",
      "no-emergence-in-window",
      "warp-limited",
    ] as const) {
      const silence = silent({
        deadlineBasis: basis,
        predictedReacquisitionUt: null,
      });
      expect(contactPhase(silence, 999_999)).toBe("waiting");
    }
  });

  it("is undefined before any silence frame has arrived", () => {
    expect(contactPhase(undefined, 1_500)).toBeUndefined();
  });
});

describe("overdueSeconds", () => {
  it("counts from the predicted emergence, not from the start of silence", () => {
    expect(overdueSeconds(silent(), 2_135)).toBe(135);
  });

  it("has no duration to report before the vessel is due", () => {
    expect(overdueSeconds(silent(), 1_500)).toBeUndefined();
  });

  it("has no duration to report when nothing was predicted", () => {
    const silence = silent({
      deadlineBasis: "no-occultation",
      predictedReacquisitionUt: null,
    });
    expect(overdueSeconds(silence, 999_999)).toBeUndefined();
  });
});
