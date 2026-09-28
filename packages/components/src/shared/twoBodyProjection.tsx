import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import { Text } from "@ksp-gonogo/ui-kit";

/**
 * Whether two-body figures from the live elements disagree with the model the
 * craft is flown on: only for an integrated `arc`, whose osculating elements
 * drift. A conic rests on the same model, and a withheld trajectory has its own
 * refusal.
 */
export function projectionDiffersFromTrajectory(
  trajectory: OrbitTrajectory | null | undefined,
): boolean {
  return trajectory?.shape === "arc";
}

/** The one sentence every widget puts beside two-body figures when the provider integrates. */
export function TwoBodyProjectionNote() {
  return (
    <Text level="muted" size="xs" role="status">
      Two-body projection. The flown trajectory accounts for other bodies, so
      the craft will drift from these figures.
    </Text>
  );
}
