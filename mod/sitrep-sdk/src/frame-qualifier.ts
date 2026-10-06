import type { ControlFrame } from "./__generated__/contract";
import { ControlFrameKind } from "./__generated__/contract";
import type { ReadFrameChoice } from "./spine/reference-frame";

/**
 * A reference frame to check a quantity against: the Control Frame as
 * `system.frame` reports it, or a widget's own read frame. Resolve a read
 * frame of `follow-control-frame` with `resolveReadFrame` first; unresolved,
 * it counts as unknown.
 *
 * @category Orbits and trajectories
 */
export type QualifiedFrame = ControlFrame | ReadFrameChoice;

function isReadFrame(frame: QualifiedFrame): frame is ReadFrameChoice {
  return typeof frame.kind === "string";
}

/**
 * Whether a quantity has a meaning in a reference frame: `"valid"`,
 * `"invalid"`, or `"unknown"` when no frame has been reported yet. Treat
 * `"unknown"` apart from `"invalid"`: the frame may simply not have arrived.
 *
 * @category Orbits and trajectories
 */
export type FrameValidity = "valid" | "invalid" | "unknown";

/**
 * Returns whether a distance shown in this frame is a real distance. In a
 * rotating-pulsating frame the unit of length changes over time, since the
 * frame holds the distance between its two bodies fixed, so a distance there
 * is `"invalid"`: hide it, or label it as a distance in that frame's units.
 *
 * @category Orbits and trajectories
 */
export function lengthsAreLengths(
  frame: QualifiedFrame | null | undefined,
): FrameValidity {
  if (frame == null) return "unknown";
  if (isReadFrame(frame)) {
    if (frame.kind === "follow-control-frame") return "unknown";
    return frame.kind === "rotating-pulsating" ? "invalid" : "valid";
  }
  if (frame.kind === ControlFrameKind.Unspecified) {
    return "unknown";
  }
  return frame.kind === ControlFrameKind.RotatingPulsating
    ? "invalid"
    : "valid";
}

/**
 * Returns whether periapsis and apoapsis exist in this frame. They need a
 * single central body, so they are `"invalid"` in the rotating frames, which
 * turn about a pair of bodies, and in a frame relative to the target.
 *
 * @category Orbits and trajectories
 */
export function apsidesExist(
  frame: QualifiedFrame | null | undefined,
): FrameValidity {
  if (frame == null) return "unknown";
  if (isReadFrame(frame)) {
    if (frame.kind === "follow-control-frame") return "unknown";
    return frame.kind === "rotating-pulsating" ? "invalid" : "valid";
  }
  // Orthogonal to the kind rather than inside it, which is why it is checked first: a target frame can carry any kind, `Unspecified` included, and still have no apsides.
  if (frame.targetFrameSelected) {
    return "invalid";
  }
  if (frame.kind === ControlFrameKind.Unspecified) {
    return "unknown";
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
 * Returns a name for the Control Frame to show beside a readout, such as
 * `"Kerbin-Centred Inertial"`, or `undefined` when no frame has been reported.
 *
 * A frame kind this version has no name for is shown by its number, and a body
 * the frame did not report keeps its placeholder, such as
 * `"<centre>-Centred Inertial"`, so a gap is visible rather than guessed at.
 *
 * @category Orbits and trajectories
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
 * Returns the text to show in place of a quantity that has no meaning in the
 * current frame, such as `"No apoapsis in this frame"`, or `undefined` when
 * the quantity is valid and should be shown. Showing a reason, rather than
 * leaving the readout blank, tells the player it comes from the frame they
 * chose and not from a lost signal.
 *
 * @param validity - From {@link lengthsAreLengths} or {@link apsidesExist}.
 * @param quantity - The quantity's name, such as `"apoapsis"`.
 *
 * @category Orbits and trajectories
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
