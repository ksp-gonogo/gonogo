import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import {
  FRAME_TYPE,
  frameHasApsides,
  frameLengthsPulsate,
  plottingFrameKindLabel,
  plottingFrameLabel,
} from "./plottingFrame";

/**
 * Kept after the widget that used this was removed, because the table is the
 * reason nobody reaches for the producer's own frame namer, and that namer aborts
 * the process. A helper with no test is a helper someone deletes as dead.
 */
describe("plottingFrameLabel", () => {
  /**
   * The ordinals the producer actually puts on the wire, read out of the
   * installed `ksp_plugin_adapter.dll`'s `FrameType`, which numbers its members
   * explicitly from 6000. The previous version of this suite asserted 0 to 4,
   * the same invented keys the table itself used, so the two were wrong together
   * and every real frame rendered as "Frame 6000" with nothing failing. Pinning
   * the producer's own numbers here is what makes the table falsifiable: a check
   * that can only compare a table against itself cannot report a mismatch.
   */
  it("is keyed by the producer's declared enum values", () => {
    expect(FRAME_TYPE).toEqual({
      bodyCentredInertial: 6000,
      barycentricRotating: 6001,
      parentDirection: 6002,
      bodySurface: 6003,
      rotatingPulsating: 6004,
    });
  });

  /*
   * The expected strings are the installed build's own, from
   * `GameData/Principia/localization/en-us.cfg`, and the separators are asserted
   * as escapes rather than as literal characters. An en dash and a hyphen are one
   * pixel apart in this file and identical in a diff read quickly, which is how
   * the two body-pair names came to be spelt with hyphens while this suite said
   * they were "the producer's own wording".
   */
  it("names each frame in the producer's own wording", () => {
    expect(
      plottingFrameLabel(FRAME_TYPE.bodyCentredInertial, { centre: "Kerbin" }),
    ).toBe("Kerbin-Centred Inertial");
    expect(plottingFrameLabel(FRAME_TYPE.bodySurface, { centre: "Duna" })).toBe(
      "Duna-Centred Duna-Fixed",
    );
    expect(
      plottingFrameLabel(FRAME_TYPE.parentDirection, {
        primary: "Kerbol",
        secondary: "Kerbin",
      }),
    ).toBe("Kerbin\u2013Kerbol\u2013Orbit");
    expect(
      plottingFrameLabel(FRAME_TYPE.rotatingPulsating, {
        primary: "Kerbin",
        secondary: "Mun",
      }),
    ).toBe("Kerbin\u2013Mun Lagrange");
  });

  /*
   * The target frame replaces the kind's name rather than qualifying it. Named
   * with the body the TARGET orbits, which is a different body from the one the
   * selector is sitting on, so the ordinal beside it is no help at all.
   */
  it("names the target frame the way the producer does", () => {
    expect(
      plottingFrameLabel(FRAME_TYPE.bodyCentredInertial, {
        centre: "Kerbin",
        targetSelected: true,
        targetPrimary: "Mun",
      }),
    ).toBe("Target\u2013Mun\u2013Orbit");
  });

  it("names the target frame with no ordinal to go on", () => {
    expect(
      plottingFrameLabel(undefined, {
        targetSelected: true,
        targetPrimary: "Duna",
      }),
    ).toBe("Target\u2013Duna\u2013Orbit");
  });

  it("leaves the target's primary visible as a gap when it was not carried", () => {
    expect(
      plottingFrameLabel(FRAME_TYPE.bodySurface, { targetSelected: true }),
    ).toBe("Target\u2013<targetPrimary>\u2013Orbit");
  });

  it("calls the target frame's kind by a name of ours, having none of theirs", () => {
    expect(plottingFrameKindLabel(FRAME_TYPE.bodyCentredInertial, true)).toBe(
      "Target frame",
    );
    expect(plottingFrameKindLabel(FRAME_TYPE.bodyCentredInertial, false)).toBe(
      "Body-centred inertial",
    );
  });

  /** A bare string still means the centre body, which is what most callers have. */
  it("takes a bare centre body", () => {
    expect(plottingFrameLabel(FRAME_TYPE.bodyCentredInertial, "Kerbin")).toBe(
      "Kerbin-Centred Inertial",
    );
  });

  /**
   * A missing body leaves its placeholder visible. Collapsing it would render
   * "-Centred Inertial", which reads as a formatting slip rather than as a frame
   * whose centre we could not read.
   */
  it("leaves a body it was not given visible as a gap", () => {
    expect(plottingFrameLabel(FRAME_TYPE.bodyCentredInertial)).toBe(
      "<centre>-Centred Inertial",
    );
  });

  /**
   * Renders the ordinal rather than guessing. A frame kind added in a later build
   * should read as obviously incomplete; rounding it to the nearest known name
   * would be a confident wrong answer about what every coordinate means.
   */
  it("refuses to guess at an unknown ordinal", () => {
    expect(plottingFrameLabel(6099, { centre: "Jool" })).toBe(
      "Frame 6099, Jool",
    );
    expect(plottingFrameLabel(3, { centre: "Jool" })).toBe("Frame 3, Jool");
  });

  it("is the null display when there is no ordinal at all", () => {
    expect(plottingFrameLabel(null)).toBe(NULL_DISPLAY);
    expect(plottingFrameLabel(undefined, { centre: "Kerbin" })).toBe(
      NULL_DISPLAY,
    );
  });
});

describe("what a frame invalidates", () => {
  it("marks the pulsating frame's lengths as not lengths", () => {
    expect(frameLengthsPulsate(FRAME_TYPE.rotatingPulsating)).toBe(true);
    expect(frameLengthsPulsate(FRAME_TYPE.bodyCentredInertial)).toBe(false);
    expect(frameLengthsPulsate(null)).toBe(false);
  });

  it("says where apsides exist at all", () => {
    expect(frameHasApsides(FRAME_TYPE.bodyCentredInertial)).toBe(true);
    expect(frameHasApsides(FRAME_TYPE.bodySurface)).toBe(true);
    expect(frameHasApsides(FRAME_TYPE.parentDirection)).toBe(true);
    expect(frameHasApsides(FRAME_TYPE.barycentricRotating)).toBe(false);
    expect(frameHasApsides(FRAME_TYPE.rotatingPulsating)).toBe(false);
  });

  /** The target frame has none whatever its kind says, so the flag wins. */
  it("has no apsides in the target frame", () => {
    expect(frameHasApsides(FRAME_TYPE.bodyCentredInertial, true)).toBe(false);
  });
});
