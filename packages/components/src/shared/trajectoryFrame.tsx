import {
  CELESTIAL_FACTS,
  drawnFrame,
  type OrbitTrajectory,
  type TrajectoryFrame,
  trajectoryFrameLabel,
  useProcessor,
} from "@ksp-gonogo/sitrep-client";
import { Text } from "@ksp-gonogo/ui-kit";

interface FrameCaptionProps {
  trajectory?: OrbitTrajectory | null;
  /** The body the elements are measured against, which is the frame a drawn conic lands in. */
  centreBodyIndex?: number;
  /** The frame outright, for a drawing that is not the seam's own curve, such as a body-fixed ground track. */
  frame?: TrajectoryFrame | null;
  /** The centre body by name, for a widget that holds a name rather than an index. */
  centreBodyName?: string | undefined;
}

/** The name of the frame a trajectory was drawn in, or `null` when nothing was drawn. */
export function useTrajectoryFrameLabel({
  trajectory,
  centreBodyIndex,
  centreBodyName,
  frame: given,
}: Readonly<FrameCaptionProps>): string | null {
  // A held catalogue is still the catalogue: a quiet link does not change it.
  const factsReading = useProcessor(CELESTIAL_FACTS);
  const facts =
    factsReading?.state === "observed" || factsReading?.state === "held"
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
  return trajectoryFrameLabel(frame, facts);
}

/**
 * Names the frame a widget drew its trajectory in; every trajectory widget
 * renders one, since the same points are a different path in each frame. One
 * component so two panels never name one frame two ways. Renders nothing when
 * nothing was drawn.
 */
export function TrajectoryFrameCaption(props: Readonly<FrameCaptionProps>) {
  const label = useTrajectoryFrameLabel(props);
  if (label === null) return null;
  return (
    <Text level="muted" size="xs">
      {label}
    </Text>
  );
}

/** The frame's name as bare text, for a `FramedDisplay` caption that sets its own type. */
export function InlaidTrajectoryFrameCaption(
  props: Readonly<FrameCaptionProps>,
) {
  return useTrajectoryFrameLabel(props);
}
