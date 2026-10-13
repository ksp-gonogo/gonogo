import {
  trajectoryWithheldCopy,
  type WithheldTrajectory,
} from "@ksp-gonogo/sitrep-sdk/frames";
import { EmptyState, Tooltip } from "@ksp-gonogo/ui-kit";

/**
 * The heading for an orbit path that is withheld, with the reason in its
 * tooltip. `fill` centres it in the box that held the drawing, `inline` sits it
 * beside a caption. Announced as a status, since a withheld path is normal
 * behaviour rather than a fault.
 */
export function WithheldPath({
  withheld,
  layout = "inline",
}: Readonly<{ withheld: WithheldTrajectory; layout?: "inline" | "fill" }>) {
  const { heading, detail } = trajectoryWithheldCopy(withheld);
  return (
    <Tooltip text={detail} focusable>
      <EmptyState role="status" layout={layout}>
        {heading}
      </EmptyState>
    </Tooltip>
  );
}
