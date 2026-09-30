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

/** The Topic {@link controlFrameToReadFrameChoice} reads its argument off. */
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
 * The live `system.frame` reading, as a `ReadFrameChoice` a widget can pass to
 * {@link resolveReadFrame}.
 *
 * Three of `ControlFrameKind`'s six members convert: `BodyCentredInertial` and
 * `BodyCentredBodyDirection` carry the centred body by name in `centreBody`,
 * and `RotatingPulsating` carries its pair explicitly in `primaryBody` /
 * `secondaryBody`, where a `ReadFrameChoice` names only the secondary and
 * infers the primary as that body's own parent. Every other kind returns
 * null: `Unspecified` because nothing was stated, `BarycentricRotating` and
 * `BodySurface` because no read-frame kind means them, and a frame with
 * `targetFrameSelected` set because it is defined against a vessel rather
 * than a body, which sits beside `kind` and no read frame carries at all.
 *
 * Also null when the frame or the catalogue is absent, or when the body name
 * it names is not (yet) in `facts.indexByName`: a mid-resync catalogue is a
 * real state, not a different frame.
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
 * Whether two read-frame choices would draw the same picture.
 *
 * A widget offering "follow the Control Frame" beside its own named frames
 * needs this to hide the option when it coincides with one already on offer,
 * rather than showing an operator two entries with one behaviour, per the
 * operator ruling that a choice which would draw identically is hidden the
 * same as a Control Frame with nothing to follow.
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
