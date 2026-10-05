import {
  type OrbitTrajectory,
  TrajectoryKindLike,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { Stack } from "./Stack";
import { Text } from "./Text";
import { Tooltip } from "./Tooltip";

/**
 * The `withheld` answer of `useOrbitTrajectory`: a path that may not be drawn,
 * and the reason why.
 *
 * @category EmptyState
 */
export type WithheldTrajectory = Extract<
  OrbitTrajectory,
  { shape: "withheld" }
>;

/**
 * The heading and sentence for a withheld path, for a widget that lays the
 * words out itself. Each reason has its own wording because each has a
 * different remedy. Use this rather than wording your own, so every widget says
 * the same refusal the same way.
 *
 * @category EmptyState
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
 * The refusal standing in for a path's drawing, as a status rather than an
 * alert: a provider declining to vouch for a path that far is the system
 * working. `compact` keeps the heading only, with the sentence on hover, for a
 * strip beside a readout or a caption.
 *
 * @category EmptyState
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
