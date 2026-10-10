import {
  type OrbitTrajectory,
  TrajectoryKindLike,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { Stack } from "./Stack";
import { Text } from "./Text";
import { Tooltip } from "./Tooltip";

/**
 * An orbit path that may not be drawn, and the reason. An orbit's elements are
 * the numbers that define its curve, and its horizon is how far ahead in game
 * time they can be trusted. The path is withheld when no horizon was stated for
 * it, the instant on screen is past its horizon, its shape (a conic drawn from
 * the elements, or an arc sampled by the provider) was not stated, the frame
 * asked for cannot be built (a body not yet received, say), or it could not be
 * sampled. It is the
 * `withheld` member of `OrbitTrajectory`, which `useOrbitTrajectory` from
 * `@ksp-gonogo/sitrep-sdk/frames` returns.
 *
 * @category EmptyState
 */
export type WithheldTrajectory = Extract<
  OrbitTrajectory,
  { shape: "withheld" }
>;

/**
 * The heading and sentence for a withheld path, for a widget that lays the
 * words out itself. Each reason has its own wording, saying what would let the
 * path be drawn. Use this rather than your own words, so every widget
 * describes a withheld path the same way.
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
        detail:
          "Nothing says how far ahead these orbital elements can be trusted.",
      };
    case "past-horizon":
      return withheld.trajectoryKind === TrajectoryKindLike.Integrated
        ? {
            heading: "BEYOND INTEGRATION",
            detail: "The trajectory is not computed this far ahead yet.",
          }
        : {
            heading: "PAST HORIZON",
            detail: "These orbital elements cannot be trusted this far ahead.",
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
 * Drawn in place of a path that is withheld: a heading and a sentence saying
 * why. It is announced as a status, not an alert, since a withheld path is
 * normal behaviour rather than a fault. `compact` shows the heading only, with
 * the sentence on hover, for a strip beside a readout or a caption.
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
