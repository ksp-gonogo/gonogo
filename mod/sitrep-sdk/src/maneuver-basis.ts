import { ManeuverFrame } from "./__generated__/contract";

/**
 * What a burn's three delta-v slots are CALLED, in the basis the burn declares.
 *
 * <p>`ManeuverNode`'s three components are positional slots, and its `frame`
 * says which basis fills them. A burn whose basis nothing stated, or one this
 * build does not recognise, gets neutral slot names rather than the stock words:
 * labelling a component "Prograde" asserts a basis nobody declared, and the
 * operator reading it has no cue that anything is unknown.</p>
 *
 * <p><b>Published from the root barrel</b> for the reason `enum-names` is: an
 * Uplink drawing burns needs the same words as the built-in node editor, and one
 * that transcribes them beside its own switch drifts from it.</p>
 *
 * <p>An unstated basis is NOT defaulted to stock. `RadialNormalPrograde` is
 * ordinal zero, so a default would assert the stock basis for components that
 * may be in another one. A recording predating the field, and a provider that
 * never set it, both get the neutral slot names instead.</p>
 *
 * @category Orbits and trajectories
 */
export type ManeuverBasisLabels = readonly [string, string, string];

/** The stock basis's own words. */
const RADIAL_NORMAL_PROGRADE: ManeuverBasisLabels = [
  "Radial",
  "Normal",
  "Prograde",
];

/**
 * Neutral slot names, for a burn whose basis nothing stated.
 *
 * Numbered rather than named, because every name available is a claim about a
 * basis nobody declared. An operator shown "Component 1" knows to go and find
 * out; one shown "Prograde" does not know there is anything to find out.
 */
const UNSTATED: ManeuverBasisLabels = [
  "Component 1",
  "Component 2",
  "Component 3",
];

/**
 * The names of a manoeuvre's three delta-v components in `frame`. A frame the
 * vessel did not state gets numbered labels rather than a guess.
 *
 * @category Orbits and trajectories
 */
export function maneuverBasisLabels(
  frame: ManeuverFrame | null | undefined,
): ManeuverBasisLabels {
  switch (frame) {
    case ManeuverFrame.RadialNormalPrograde:
      return RADIAL_NORMAL_PROGRADE;
    default:
      return UNSTATED;
  }
}
