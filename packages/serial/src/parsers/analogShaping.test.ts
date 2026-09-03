import { describe, expect, it } from "vitest";
import { applyAnalogShaping } from "./analogShaping";

describe("applyAnalogShaping", () => {
  it("is a no-op with default settings", () => {
    expect(applyAnalogShaping({}, 0)).toBe(0);
    expect(applyAnalogShaping({}, 0.42)).toBe(0.42);
    expect(applyAnalogShaping({}, -1)).toBe(-1);
  });

  it("snaps inside the deadzone to zero", () => {
    expect(applyAnalogShaping({ deadzone: 0.1 }, 0.05)).toBe(0);
    expect(applyAnalogShaping({ deadzone: 0.1 }, -0.099)).toBe(0);
  });

  it("rescales outside the deadzone so the curve still saturates at ±1", () => {
    expect(applyAnalogShaping({ deadzone: 0.2 }, 0.6)).toBeCloseTo(0.5, 5);
    expect(applyAnalogShaping({ deadzone: 0.2 }, 1)).toBe(1);
    expect(applyAnalogShaping({ deadzone: 0.2 }, -1)).toBe(-1);
  });

  it("squared curve preserves sign and softens centre", () => {
    expect(applyAnalogShaping({ curve: "squared" }, 0.5)).toBeCloseTo(0.25, 5);
    expect(applyAnalogShaping({ curve: "squared" }, -0.5)).toBeCloseTo(
      -0.25,
      5,
    );
    expect(applyAnalogShaping({ curve: "squared" }, 1)).toBe(1);
  });

  it("cubic curve squashes more aggressively near centre", () => {
    expect(applyAnalogShaping({ curve: "cubic" }, 0.5)).toBeCloseTo(0.125, 5);
    expect(applyAnalogShaping({ curve: "cubic" }, -0.5)).toBeCloseTo(-0.125, 5);
    expect(applyAnalogShaping({ curve: "cubic" }, 1)).toBe(1);
  });

  it("composes deadzone and curve in order", () => {
    // deadzone 0.2, value 0.6 → rescaled to 0.5 → squared to 0.25
    expect(
      applyAnalogShaping({ deadzone: 0.2, curve: "squared" }, 0.6),
    ).toBeCloseTo(0.25, 5);
  });

  it("ignores invalid deadzone values", () => {
    expect(applyAnalogShaping({ deadzone: 0 }, 0.05)).toBe(0.05);
    expect(applyAnalogShaping({ deadzone: 1 }, 0.5)).toBe(0.5);
    expect(applyAnalogShaping({ deadzone: -0.1 }, 0.5)).toBe(0.5);
  });

  it("defaults to bipolar when polarity is unset, existing types unchanged", () => {
    expect(applyAnalogShaping({}, -1)).toBe(-1);
    expect(applyAnalogShaping({ polarity: undefined }, -1)).toBe(-1);
    expect(applyAnalogShaping({ deadzone: 0.2, polarity: undefined }, -1)).toBe(
      -1,
    );
  });

  describe("unipolar (0..1, e.g. triggers)", () => {
    it("rests at 0, not -1", () => {
      expect(applyAnalogShaping({ polarity: "unipolar" }, 0)).toBe(0);
    });

    it("saturates at 1 for full travel", () => {
      expect(applyAnalogShaping({ polarity: "unipolar" }, 1)).toBe(1);
    });

    it("is a no-op at half travel with no deadzone", () => {
      expect(applyAnalogShaping({ polarity: "unipolar" }, 0.5)).toBe(0.5);
    });

    it("snaps below the deadzone to 0", () => {
      expect(
        applyAnalogShaping({ polarity: "unipolar", deadzone: 0.1 }, 0.05),
      ).toBe(0);
      expect(
        applyAnalogShaping({ polarity: "unipolar", deadzone: 0.1 }, 0),
      ).toBe(0);
    });

    it("rescales travel above the deadzone so it still reaches 1", () => {
      expect(
        applyAnalogShaping({ polarity: "unipolar", deadzone: 0.2 }, 0.6),
      ).toBeCloseTo(0.5, 5);
      expect(
        applyAnalogShaping({ polarity: "unipolar", deadzone: 0.2 }, 1),
      ).toBe(1);
    });

    it("never goes negative even with a curve applied", () => {
      expect(
        applyAnalogShaping({ polarity: "unipolar", curve: "squared" }, 0.5),
      ).toBeCloseTo(0.25, 5);
      expect(
        applyAnalogShaping({ polarity: "unipolar", curve: "cubic" }, 0.5),
      ).toBeCloseTo(0.125, 5);
      // Negative inputs, because for every non-negative one the unipolar
      // branch computes exactly what the bipolar branch computes: feed it
      // only those and the whole branch can be deleted with this file still
      // green.
      expect(
        applyAnalogShaping({ polarity: "unipolar", curve: "squared" }, -1),
      ).toBe(0);
      expect(
        applyAnalogShaping({ polarity: "unipolar", curve: "cubic" }, -0.5),
      ).toBe(0);
    });

    it("rests at 0 for a released trigger reporting below rest, with no deadzone set", () => {
      // The failure the polarity distinction exists to prevent, in the shape
      // it actually arrives in. A trigger mapped to a gamepad AXIS reports -1
      // when released, and `deadzone` is unset by default, so the snap-to-rest
      // branch never ran: bound to a throttle, the rest position read full
      // reverse.
      expect(applyAnalogShaping({ polarity: "unipolar" }, -1)).toBe(0);
      expect(applyAnalogShaping({ polarity: "unipolar" }, -0.2)).toBe(0);
    });

    it("is the bipolar answer's opposite below rest, which is the whole point of the branch", () => {
      // Both polarities on the same input, side by side: a bipolar stick at
      // -1 is a real deflection and stays -1, a unipolar trigger at -1 is
      // released and is 0. Nothing else in this block can tell the two
      // branches apart.
      expect(applyAnalogShaping({ polarity: "bipolar" }, -1)).toBe(-1);
      expect(applyAnalogShaping({ polarity: "unipolar" }, -1)).toBe(0);
    });
  });
});
