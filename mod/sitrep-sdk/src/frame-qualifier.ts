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
 * Each kind's label, with the placeholders it declines with. `<centre>` is the
 * frame's centre body, `<primary>` the body a rotating frame turns about and
 * `<secondary>` the one it is anchored to.
 */
const FRAME_NAMES: Readonly<Record<number, string>> = {
  [ControlFrameKind.BodyCentredInertial]: "<centre>-Centred Inertial",
  [ControlFrameKind.BarycentricRotating]: "Barycentric rotating",
  [ControlFrameKind.BodyCentredBodyDirection]: "<secondary>-<primary>-Orbit",
  [ControlFrameKind.BodySurface]: "<centre>-Centred <centre>-Fixed",
  [ControlFrameKind.RotatingPulsating]: "<primary>-<secondary> Lagrange",
};

/**
 * The frame in force, named so an operator can see WHY a readout beside it says
 * a quantity does not exist.
 *
 * <p>A kind this build has no name for renders as the kind rather than as a
 * guess: a frame added by a later producer should read as obviously incomplete
 * instead of being rounded to whichever neighbour is closest, because a wrong
 * frame name is a wrong claim about what every coordinate on the board
 * means.</p>
 *
 * <p>A body the payload did not carry leaves its placeholder standing, for the
 * same reason: "&lt;centre&gt;-Centred Inertial" says a body is missing, where
 * "-Centred Inertial" reads like a formatting slip.</p>
 */
export function controlFrameLabel(
  frame: ControlFrame | undefined,
): string | undefined {
  if (frame === undefined) {
    return undefined;
  }
  if (frame.targetFrameSelected) {
    // Orthogonal to the kind, and it is what the operator selected, so it is
    // what they are told: naming the underlying kind here would caption the
    // frame they did not choose.
    return "Target frame";
  }
  const template = FRAME_NAMES[frame.kind];
  if (template === undefined) {
    return frame.centreBody
      ? `Frame ${frame.kind}, ${frame.centreBody}`
      : `Frame ${frame.kind}`;
  }
  return template
    .replace(/<centre>/g, frame.centreBody ?? "<centre>")
    .replace(/<primary>/g, frame.primaryBody ?? "<primary>")
    .replace(/<secondary>/g, frame.secondaryBody ?? "<secondary>");
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
