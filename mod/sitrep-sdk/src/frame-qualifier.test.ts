import { describe, expect, it } from "vitest";
import type { ControlFrame } from "./__generated__/contract";
import { ControlFrameKind } from "./__generated__/contract";
import {
  apsidesExist,
  controlFrameLabel,
  frameCaveat,
  lengthsAreLengths,
} from "./frame-qualifier";

function frame(
  kind: ControlFrameKind,
  targetFrameSelected?: boolean,
): ControlFrame {
  return { kind, targetFrameSelected } as ControlFrame;
}

describe("what the frame in force does to a readout", () => {
  it("keeps a length a length in the centred frames", () => {
    expect(lengthsAreLengths(frame(ControlFrameKind.BodyCentredInertial))).toBe(
      "valid",
    );
    expect(lengthsAreLengths(frame(ControlFrameKind.BodySurface))).toBe(
      "valid",
    );
  });

  it("says a length is not a length in a pulsating frame", () => {
    // Its two primaries' separation is held fixed, so its length unit varies
    // with time. Quoting an absolute length in it states a number that is not
    // the quantity its label claims.
    expect(lengthsAreLengths(frame(ControlFrameKind.RotatingPulsating))).toBe(
      "invalid",
    );
  });

  it("has apsides in the frames that have a centre", () => {
    expect(apsidesExist(frame(ControlFrameKind.BodyCentredInertial))).toBe(
      "valid",
    );
    expect(apsidesExist(frame(ControlFrameKind.BodyCentredBodyDirection))).toBe(
      "valid",
    );
    expect(apsidesExist(frame(ControlFrameKind.BodySurface))).toBe("valid");
  });

  it("has no apsides in the frames defined by a pair rather than a centre", () => {
    // An apsis is defined against a centre. In these it is not unavailable, it
    // is undefined, which is a different thing to tell an operator.
    expect(apsidesExist(frame(ControlFrameKind.BarycentricRotating))).toBe(
      "invalid",
    );
    expect(apsidesExist(frame(ControlFrameKind.RotatingPulsating))).toBe(
      "invalid",
    );
  });

  it("has no apsides in a target frame whatever its kind", () => {
    // The target flag sits orthogonally to the kind, so a target frame carrying
    // an apsis-bearing kind still has none. Checked with the kind that would
    // otherwise pass, so the check cannot pass by agreeing with the kind.
    expect(
      apsidesExist(frame(ControlFrameKind.BodyCentredInertial, true)),
    ).toBe("invalid");
  });

  it("says unknown rather than guessing when no frame has been reported", () => {
    // Defaulting to valid quotes a length in a frame where lengths are not
    // lengths; defaulting to invalid blanks the boards for the moment before
    // the first frame sample lands. Neither is an answer.
    expect(lengthsAreLengths(undefined)).toBe("unknown");
    expect(apsidesExist(undefined)).toBe("unknown");
    expect(lengthsAreLengths(frame(ControlFrameKind.Unspecified))).toBe(
      "unknown",
    );
    expect(apsidesExist(frame(ControlFrameKind.Unspecified))).toBe("unknown");
  });

  it("puts nothing in the way of a number the frame does not invalidate", () => {
    expect(frameCaveat("valid", "periapsis")).toBeUndefined();
  });

  it("says the quantity does not exist here rather than leaving a blank", () => {
    // A readout that simply vanishes reads as a link fault. This is a fact
    // about the operator's own view, and one they can act on.
    expect(frameCaveat("invalid", "periapsis")).toBe(
      "No periapsis in this frame",
    );
  });

  it("keeps not-knowing distinct from not-existing in what it shows", () => {
    const unknown = frameCaveat("unknown", "periapsis");

    expect(unknown).toBeTruthy();
    expect(unknown).not.toBe(frameCaveat("invalid", "periapsis"));
  });
});

describe("naming the frame in force", () => {
  it("declines a centred frame's name with its centre body", () => {
    expect(
      controlFrameLabel({
        kind: ControlFrameKind.BodyCentredInertial,
        centreBody: "Kerbin",
      } as ControlFrame),
    ).toBe("Kerbin-Centred Inertial");
  });

  it("declines a rotating frame's name with both its bodies", () => {
    expect(
      controlFrameLabel({
        kind: ControlFrameKind.RotatingPulsating,
        primaryBody: "Kerbol",
        secondaryBody: "Kerbin",
      } as ControlFrame),
    ).toBe("Kerbol-Kerbin Lagrange");
  });

  it("names the target frame as what the operator chose, not its kind", () => {
    // The flag is orthogonal to the kind, and naming the kind would caption a
    // frame they did not select.
    expect(
      controlFrameLabel({
        kind: ControlFrameKind.BodyCentredInertial,
        centreBody: "Kerbin",
        targetFrameSelected: true,
      } as ControlFrame),
    ).toBe("Target frame");
  });

  it("leaves a missing body's placeholder standing rather than collapsing the name", () => {
    // "-Centred Inertial" reads like a formatting slip; the placeholder says a
    // body is missing.
    expect(
      controlFrameLabel({
        kind: ControlFrameKind.BodyCentredInertial,
      } as ControlFrame),
    ).toBe("<centre>-Centred Inertial");
  });

  it("renders an unnamed kind as the kind rather than the nearest neighbour", () => {
    // A wrong frame name is a wrong claim about what every coordinate on the
    // board means, so an unknown one reads as obviously incomplete.
    // Through `unknown`, because no `ControlFrameKind` is 99 and the compiler
    // is right about that: the value models a mod that is ahead of this client,
    // which is the only way such a frame reaches the label.
    expect(controlFrameLabel({ kind: 99 } as unknown as ControlFrame)).toBe(
      "Frame 99",
    );
  });

  it("names nothing when no frame has been reported", () => {
    expect(controlFrameLabel(undefined)).toBeUndefined();
  });
});
