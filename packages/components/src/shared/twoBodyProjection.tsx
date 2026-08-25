import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import { Text } from "@ksp-gonogo/ui-kit";

/**
 * Whether a figure derived from the live elements by a two-body solver
 * disagrees with the model the provider is actually flying the craft on.
 *
 * <para>The seam answers `arc` when the provider integrates: the elements it
 * sent are osculating, exact at the sample instant and drifting from there. A
 * post-burn apoapsis, eccentricity or period computed from them is the orbit
 * the craft would settle into if nothing else pulled on it, which is the single
 * assumption an integrating provider exists to deny. The number is still worth
 * showing, it is the operator's first-order estimate and the only one available
 * before the burn is committed; what is not acceptable is showing it in the
 * same words and the same precision as under a provider where it is exact.</para>
 *
 * <para>`conic` is not qualified, because there the projection and the
 * trajectory rest on the same model and there is no disagreement to declare. A
 * banner on every stock dashboard is how an operator learns to stop reading
 * them. `withheld` is not qualified either: that case has its own refusal
 * vocabulary next door and the drawing is gone rather than caveated.</para>
 */
export function projectionDiffersFromTrajectory(
  trajectory: OrbitTrajectory | null | undefined,
): boolean {
  return trajectory?.shape === "arc";
}

/**
 * The sentence a widget puts beside two-body figures when the provider
 * integrates.
 *
 * One wording rather than one per widget, for the reason its refusal sibling
 * gives: several widgets present derived post-burn or projected figures over
 * the same seam, and an operator meeting a different sentence on each panel for
 * the identical fact reads them as several different faults.
 *
 * It names neither the provider nor the mechanism. What the operator needs is
 * that these figures assume nothing else pulls on the craft and the flown
 * trajectory does not, and a word like "integrator" answers a question they did
 * not ask.
 */
export function TwoBodyProjectionNote() {
  return (
    <Text tone="muted" size="xs" role="status">
      Two-body projection. The flown trajectory accounts for other bodies, so
      the craft will drift from these figures.
    </Text>
  );
}
