import type { ControlFrame } from "./__generated__/contract";
import { ControlFrameKind } from "./__generated__/contract";

/**
 * Whether a quantity means anything in the frame currently in force.
 *
 * <p>Three states rather than a boolean, because "we have not been told what
 * frame this is" is not the same answer as "this frame makes the number
 * meaningless", and collapsing them picks one wrong behaviour or the other: a
 * boolean that defaults to valid quotes a length in a frame where lengths are
 * not lengths, and one that defaults to invalid blanks the boards for the
 * moment before the first frame sample lands.</p>
 */
export type FrameValidity = "valid" | "invalid" | "unknown";

/**
 * Whether a distance quoted in this frame is a distance.
 *
 * <p>A rotating-pulsating frame holds its two primaries' separation fixed, so
 * its length unit varies with time. A readout in that frame must suppress an
 * absolute length or label it as a pulsating-frame unit, and that is a physics
 * rule rather than a wording choice, so it lives here once instead of in each
 * widget that quotes a length.</p>
 */
export function lengthsAreLengths(
  frame: ControlFrame | undefined,
): FrameValidity {
  if (frame === undefined || frame.kind === ControlFrameKind.Unspecified) {
    return "unknown";
  }
  return frame.kind === ControlFrameKind.RotatingPulsating
    ? "invalid"
    : "valid";
}

/**
 * Whether apsides exist in this frame at all.
 *
 * <p>An apsis is defined against a centre, and the rotating frames have a pair
 * rather than a centre; a frame defined against the current target returns
 * before apsides are computed at all. In those an apsis is not merely
 * unavailable, it is undefined, which is a different thing to tell an operator
 * than "not measured".</p>
 */
export function apsidesExist(frame: ControlFrame | undefined): FrameValidity {
  if (frame === undefined || frame.kind === ControlFrameKind.Unspecified) {
    return "unknown";
  }
  // Orthogonal to the kind rather than inside it, which is why it is checked
  // first: a target frame can carry any kind and still have no apsides.
  if (frame.targetFrameSelected) {
    return "invalid";
  }
  switch (frame.kind) {
    case ControlFrameKind.BodyCentredInertial:
    case ControlFrameKind.BodyCentredBodyDirection:
    case ControlFrameKind.BodySurface:
      return "valid";
    default:
      return "invalid";
  }
}

/**
 * What to put where a number would go, or undefined when the number itself
 * belongs there.
 *
 * <p>The sentence rather than a blank, because a readout that simply vanishes
 * reads as a link fault. This is the console saying the quantity does not exist
 * in the frame the operator chose, which is a fact about their own view and
 * something they can act on by changing it.</p>
 */
export function frameCaveat(
  validity: FrameValidity,
  quantity: string,
): string | undefined {
  if (validity === "valid") {
    return undefined;
  }
  return validity === "invalid"
    ? `No ${quantity} in this frame`
    : `${quantity} unqualified: no frame reported`;
}
