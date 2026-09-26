import {
  CELESTIAL_FACTS,
  drawnFrame,
  type OrbitTrajectory,
  type TrajectoryFrame,
  trajectoryFrameLabel,
  useProcessor,
} from "@ksp-gonogo/sitrep-client";
import { Text } from "@ksp-gonogo/ui-kit";

/**
 * Names the frame a widget drew its trajectory in; every trajectory widget
 * renders one, since the same points are a different path in each frame. One
 * component so two panels never name one frame two ways. Renders nothing when
 * nothing was drawn.
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
  /** The frame outright, for a drawing that is not the seam's own curve, such as a body-fixed ground track. */
  frame?: TrajectoryFrame | null;
  /** The centre body by name, for a widget that holds a name rather than an index. */
  centreBodyName?: string | undefined;
}>) {
  // A held catalogue is still the catalogue: a quiet link does not change it.
  const factsReading = useProcessor(CELESTIAL_FACTS);
  const facts =
    factsReading?.state === "observed" || factsReading?.state === "stale"
      ? factsReading.value
      : undefined;
  const named =
    centreBodyName === undefined
      ? undefined
      : facts?.indexByName[centreBodyName];
  const frame = given
    ? { ...given, centreBodyIndex: given.centreBodyIndex ?? named }
    : drawnFrame(trajectory, centreBodyIndex ?? named);
  if (frame == null) return null;
  const label = trajectoryFrameLabel(frame, facts);
  return (
    <Text tone="muted" size="xs">
      {label}
    </Text>
  );
}
