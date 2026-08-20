import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { plottingFrameLabel } from "./plottingFrame";

/**
 * Kept after the widget that used this was removed, because the table is the
 * reason nobody reaches for the producer's own frame namer, and that namer aborts
 * the process. A helper with no test is a helper someone deletes as dead.
 */
describe("plottingFrameLabel", () => {
  it("names a known frame, with its centre body", () => {
    expect(plottingFrameLabel(3, "Duna")).toBe("Rotating-pulsating, Duna");
    expect(plottingFrameLabel(0, "Kerbin")).toBe(
      "Body-centred non-rotating, Kerbin",
    );
  });

  it("names a known frame with no centre body", () => {
    expect(plottingFrameLabel(2)).toBe("Body surface");
  });

  /**
   * Renders the ordinal rather than guessing. A frame kind added in a later build
   * should read as obviously incomplete; rounding it to the nearest known name
   * would be a confident wrong answer about what every coordinate means.
   */
  it("refuses to guess at an unknown ordinal", () => {
    expect(plottingFrameLabel(99, "Jool")).toBe("Frame 99, Jool");
  });

  it("is the null display when there is no ordinal at all", () => {
    expect(plottingFrameLabel(null)).toBe(NULL_DISPLAY);
    expect(plottingFrameLabel(undefined, "Kerbin")).toBe(NULL_DISPLAY);
  });
});
