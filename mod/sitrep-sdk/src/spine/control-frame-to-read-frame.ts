/**
 * The live Control Frame, translated into the vocabulary a read frame already
 * draws in.
 *
 * `system.frame` and `ReadFrameChoice` were built by different halves of the
 * same idea and never introduced: `ControlFrameKind` names six states because
 * it has to describe everything a producer might elect, including two
 * (`BarycentricRotating`, `BodySurface`) and the target-relative flag that a
 * `ReadFrameChoice` has no member for at all. So this is a partial map, and
 * returning null for the frames it cannot represent is the honest answer
 * rather than a guess at the nearest neighbour: {@link resolveReadFrame}
 * already treats null as "nothing to follow" for exactly this reason.
 */

import type { ControlFrame } from "../__generated__/contract";
import { ControlFrameKind } from "../__generated__/contract";
import type { CelestialFacts } from "./celestial-facts";
import type { ReadFrameChoice } from "./reference-frame";

/**
 * The Topic (`system.frame`) that carries the frame of reference the operator
 * has selected in the game. Useful for offering a "follow the Control Frame"
 * choice to a widget that draws in a frame. Read by the orbit view and
 * system view widgets, which pass its reading to
 * {@link controlFrameToReadFrameChoice}.
 *
 * @category Frames of reference
 */
export const CONTROL_FRAME_TOPIC = "system.frame";

/** `facts.indexByName[name]`, folding a missing name and a missing catalogue into one null. */
function indexFor(
  facts: CelestialFacts,
  name: string | null | undefined,
): number | null {
  if (!name) return null;
  const index = facts.indexByName[name];
  return index === undefined ? null : index;
}

/**
 * The frame of reference the operator selected in the game, from the
 * `system.frame` reading, as a {@link ReadFrameChoice} to pass to
 * {@link resolveReadFrame}. Useful for drawing a widget in the same frame the
 * operator is flying in. Used by the orbit view and system view widgets.
 *
 * Only three frame kinds have a matching choice: body-centred inertial,
 * body-centred with the body direction, and rotating-pulsating. Every other
 * frame, a frame relative to a target vessel, and a frame whose body is not
 * in `facts` yet, return `null`. So does a missing frame or catalogue.
 *
 * @category Frames of reference
 */
export function controlFrameToReadFrameChoice(
  frame: ControlFrame | null | undefined,
  facts: CelestialFacts | undefined,
): ReadFrameChoice | null {
  if (frame == null || facts === undefined) return null;
  if (frame.targetFrameSelected) return null;
  switch (frame.kind) {
    case ControlFrameKind.BodyCentredInertial: {
      const bodyIndex = indexFor(facts, frame.centreBody);
      return bodyIndex === null
        ? null
        : { kind: "body-centred-inertial", bodyIndex };
    }
    case ControlFrameKind.BodyCentredBodyDirection: {
      const bodyIndex = indexFor(facts, frame.centreBody);
      return bodyIndex === null
        ? null
        : { kind: "parent-direction", bodyIndex };
    }
    case ControlFrameKind.RotatingPulsating: {
      const bodyIndex = indexFor(facts, frame.secondaryBody);
      return bodyIndex === null
        ? null
        : { kind: "rotating-pulsating", bodyIndex };
    }
    default:
      return null;
  }
}

/**
 * Whether two frame choices would draw the same picture. Useful for hiding a
 * "follow the Control Frame" option when it matches a frame already offered, so
 * the operator does not see two entries that do the same thing. Used by the
 * read-frame control and the orbit view and system view widgets.
 *
 * @category Frames of reference
 */
export function readFrameChoicesEqual(
  a: ReadFrameChoice | null,
  b: ReadFrameChoice | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && (a.bodyIndex ?? null) === (b.bodyIndex ?? null);
}
