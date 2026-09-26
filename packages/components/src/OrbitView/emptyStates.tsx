import type { ReckoningDecline } from "@ksp-gonogo/sitrep-sdk";
import { Text } from "@ksp-gonogo/ui-kit";
import {
  trajectoryWithheldCopy,
  type WithheldTrajectory,
} from "../shared/trajectoryWithheld";
import { NoData } from "./styles";

/** The refusal copy comes from the shared table; only the container is local, and it takes over the whole panel body. */
export function TrajectoryWithheld({
  withheld,
}: Readonly<{ withheld: WithheldTrajectory }>) {
  const { heading, detail } = trajectoryWithheldCopy(withheld);
  return (
    <NoData role="status">
      <Text size="xs">{heading}</Text>
      <Text tone="muted" size="xs">
        {detail}
      </Text>
    </NoData>
  );
}

/** The empty-state sentence, from why the conic withdrew; the switch is exhaustive so a new reason is a compile error. */
export function noOrbitSentence(
  declined: ReckoningDecline | undefined,
): string {
  if (declined === undefined) return "No orbital data";
  const reason = declined.reason;
  switch (reason) {
    case "under-physics":
      // The orbit exists; the craft is loaded, so its elements are osculating and there is no coast to draw.
      return "No osculating orbit (packed)";
    case "input-absent":
    case "beyond-horizon":
    case "model-inapplicable":
    case "contested":
    case "insufficient-history":
      return "No orbital data";
    default: {
      const unnamed: never = reason;
      return unnamed;
    }
  }
}
