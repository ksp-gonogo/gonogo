import {
  type OrbitTrajectory,
  TrajectoryKindLike,
} from "@ksp-gonogo/sitrep-client";
import { Stack, Text, Tooltip } from "@ksp-gonogo/ui-kit";

/** A refusal from the propagation seam, narrowed for the readouts below. */
export type WithheldTrajectory = Extract<
  OrbitTrajectory,
  { shape: "withheld" }
>;

/**
 * What a widget says when the propagation seam refuses a curve, in the badge's
 * vocabulary. Each reason keeps its own sentence because each has a different
 * remedy; one table so no two panels word the same refusal differently.
 */
export function trajectoryWithheldCopy(withheld: WithheldTrajectory): {
  heading: string;
  detail: string;
} {
  switch (withheld.reason) {
    case "no-horizon-stated":
      return {
        heading: "NO HORIZON STATED",
        detail: "Nothing has said how far these elements answer for.",
      };
    case "past-horizon":
      return withheld.trajectoryKind === TrajectoryKindLike.Integrated
        ? {
            heading: "BEYOND INTEGRATION",
            detail: "The trajectory is not computed this far ahead yet.",
          }
        : {
            heading: "PAST HORIZON",
            detail: "These elements do not answer for the instant on screen.",
          };
    case "shape-not-stated":
      return {
        heading: "SHAPE NOT STATED",
        detail: "Nothing has said whether this trajectory is a conic.",
      };
    case "frame-unavailable":
      return {
        heading: "FRAME UNAVAILABLE",
        detail:
          "The trajectory is fine; the frame it was asked for cannot be built from the bodies known here. Pick another frame.",
      };
    default:
      return {
        heading: "NO PATH AVAILABLE",
        detail: "The integrated trajectory could not be sampled.",
      };
  }
}

/**
 * The refusal standing in for the drawing. A status, not an alert: a provider
 * declining to extrapolate is the system working. `compact` keeps the heading
 * only, for a strip beside a readout.
 */
export function TrajectoryWithheldNote({
  withheld,
  compact = false,
}: Readonly<{ withheld: WithheldTrajectory; compact?: boolean }>) {
  const { heading, detail } = trajectoryWithheldCopy(withheld);
  return (
    <Tooltip text={compact ? detail : undefined} focusable>
      <Stack role="status">
        <Text size="xs">{heading}</Text>
        {!compact && (
          <Text level="muted" size="xs">
            {detail}
          </Text>
        )}
      </Stack>
    </Tooltip>
  );
}
