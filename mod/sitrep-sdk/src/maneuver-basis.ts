import { ManeuverFrame } from "./__generated__/contract";

/**
 * The names of a burn's three delta-v components, in order, as
 * {@link maneuverBasisLabels} returns them.
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
 * Returns the names of a manoeuvre's three delta-v components in `frame`, the
 * same words the built-in node editor uses: `["Radial", "Normal", "Prograde"]`
 * for the stock frame. A frame that is unknown or not stated gets
 * `["Component 1", "Component 2", "Component 3"]` rather than the stock words,
 * which would claim a frame nobody declared.
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
