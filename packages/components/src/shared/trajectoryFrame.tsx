import {
  CELESTIAL_FACTS,
  drawnFrame,
  frameCoordinatesArePulsating,
  type OrbitTrajectory,
  type TrajectoryFrame,
  trajectoryFrameLabel,
  useProcessor,
} from "@ksp-gonogo/sitrep-client";
import { Text } from "@ksp-gonogo/ui-kit";

/**
 * Which frame a widget drew its curve in, said out loud beside the curve.
 *
 * <b>Every widget that draws a trajectory renders one of these.</b> The same
 * points are a different path in every frame: an orbit that closes in one is a
 * rosette in another, and a Lagrange point that sits still in one sweeps round
 * in the rest. A curve with no frame named is a picture whose meaning the
 * reader has to guess, and the guess it invites is whichever frame that widget
 * happened to draw in last time they looked.
 *
 * One component rather than four captions, for the reason the refusal copy is
 * one table: four widgets naming the same frame four ways is one problem
 * wearing four hats, and an operator comparing two panels would reasonably read
 * two names as two frames.
 *
 * Renders nothing when nothing was drawn. A refusal already says its own piece
 * where the curve would have been, and a frame name beside an absent curve is a
 * caption with no picture.
 */
export function TrajectoryFrameCaption({
  trajectory,
  centreBodyIndex,
  centreBodyName,
  frame: given,
}: Readonly<{
  trajectory?: OrbitTrajectory | null;
  /** The body the elements are measured against, which is the frame a drawn conic lands in. */
  centreBodyIndex?: number;
  /**
   * The frame outright, for a widget whose drawing is not the seam's own curve.
   * A ground track is a body-fixed projection however the path was computed, so
   * naming the path's frame there would caption the wrong picture.
   */
  frame?: TrajectoryFrame | null;
  /** The centre body by name, for a widget that holds a name rather than an index. */
  centreBodyName?: string | undefined;
}>) {
  const facts = useProcessor(CELESTIAL_FACTS);
  const named =
    centreBodyName === undefined
      ? undefined
      : facts?.indexByName[centreBodyName];
  const frame = given
    ? { ...given, centreBodyIndex: given.centreBodyIndex ?? named }
    : drawnFrame(trajectory, centreBodyIndex ?? named);
  if (frame == null) return null;
  const label = trajectoryFrameLabel(frame, facts);
  const pulsating = frameCoordinatesArePulsating(frame);
  return (
    // The frame's name and nothing else. The caption says WHICH frame the curve
    // is in, because the same points are a different path in each; a frame's
    // own properties are known to whoever selected it.
    <Text tone="muted" size="xs">
      {label}
    </Text>
  );
}
