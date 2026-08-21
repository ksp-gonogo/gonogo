import {
  type OrbitTrajectory,
  TrajectoryKindLike,
} from "@ksp-gonogo/sitrep-client";
import { Stack, Text } from "@ksp-gonogo/ui-kit";

/** A refusal from the propagation seam, narrowed for the readouts below. */
export type WithheldTrajectory = Extract<
  OrbitTrajectory,
  { shape: "withheld" }
>;

/**
 * What a widget says when the propagation seam declines to authorise a curve.
 *
 * A heading in the same vocabulary `TrajectoryCurrencyBridge` badges with, so
 * an operator reading a badge and a drawing sees one word for one fact, plus a
 * line saying what it means for this particular drawing. The four reasons stay
 * four sentences: "nobody stated a horizon" and "you have outrun a stated one"
 * have different remedies, and an integrator that has not computed this far
 * ahead yet resolves on its own where a producer that dropped a field does not.
 *
 * One table, not one per widget. Six widgets draw a trajectory and every one of
 * them can now be refused; six copies of these sentences would drift, and an
 * operator seeing "SHAPE NOT STATED" on one panel and something else on the
 * next for the identical refusal would reasonably read them as two faults.
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
    default:
      return {
        heading: "NO PATH AVAILABLE",
        detail: "The integrated trajectory could not be sampled.",
      };
  }
}

/**
 * The refusal as a block that stands in for the drawing it replaced.
 *
 * `role="status"` because it appears where a curve was: the drawing going away
 * is a state change an operator must not have to notice visually. It is
 * deliberately not `alert`, a provider declining to extrapolate is the system
 * working.
 *
 * `compact` drops the second line for the slots that are a strip beside a
 * readout rather than a panel body. The heading alone still names which of the
 * four happened, which is the part that cannot be dropped.
 */
export function TrajectoryWithheldNote({
  withheld,
  compact = false,
}: Readonly<{ withheld: WithheldTrajectory; compact?: boolean }>) {
  const { heading, detail } = trajectoryWithheldCopy(withheld);
  return (
    <Stack gap="xs" role="status" title={compact ? detail : undefined}>
      <Text size="xs">{heading}</Text>
      {!compact && (
        <Text tone="muted" size="xs">
          {detail}
        </Text>
      )}
    </Stack>
  );
}
