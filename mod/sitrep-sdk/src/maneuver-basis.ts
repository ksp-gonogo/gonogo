import { ManeuverFrame } from "./__generated__/contract";

/**
 * What a burn's three delta-v slots are CALLED, in the basis the burn declares.
 *
 * <p>`ManeuverNode`'s three components are positional slots, and its
 * `frame` says which basis fills them. The field names are the stock basis's, so
 * under `TangentNormalBinormal` the field called `dvRadial` carries the TANGENT
 * and the one called `dvPrograde` carries the BINORMAL. The contract says so at
 * length, and says why: a reader that labels by field name "silently rotates
 * every burn an integrating planner produces while looking right".</p>
 *
 * <p>That is not a rename. A tangent is stock's prograde and a binormal is out
 * of plane, so labelling a Frenet burn with the stock words swaps the
 * along-track component with the out-of-plane one, and the operator reading it
 * has no cue that anything moved.</p>
 *
 * <p><b>Published from the root barrel</b> for the reason `enum-names` is: an
 * Uplink whose planner works in the Frenet trihedron needs these words as much
 * as the built-in node editor does, and one that transcribes them beside its own
 * switch is back to the defect this table ends. The Principia flight-plan
 * composer had exactly that transcription, with a paragraph of comment holding
 * it in place.</p>
 *
 * <p>An unstated basis is NOT defaulted to stock. `RadialNormalPrograde` is
 * ordinal zero, so a default would assert the stock basis for components that
 * may be in another one, which is the claim this whole table exists to stop
 * anyone making by accident. A recording predating the field, and a provider
 * that never set it, both get the neutral slot names instead.</p>
 */
export type ManeuverBasisLabels = readonly [string, string, string];

/** The stock basis's own words, and the fallback an unstated basis gets. */
const RADIAL_NORMAL_PROGRADE: ManeuverBasisLabels = [
  "Radial",
  "Normal",
  "Prograde",
];

/**
 * The Frenet trihedron's words. `Normal` is deliberately the same string as the
 * stock basis's second slot and a different quantity: the Frenet normal is the
 * in-plane one where stock's is out of plane. Keeping the producer's own word is
 * right, and it is why the other two must not be glossed into stock terms.
 */
const TANGENT_NORMAL_BINORMAL: ManeuverBasisLabels = [
  "Tangent",
  "Normal",
  "Binormal",
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

export function maneuverBasisLabels(
  frame: ManeuverFrame | null | undefined,
): ManeuverBasisLabels {
  switch (frame) {
    case ManeuverFrame.RadialNormalPrograde:
      return RADIAL_NORMAL_PROGRADE;
    case ManeuverFrame.TangentNormalBinormal:
      return TANGENT_NORMAL_BINORMAL;
    default:
      return UNSTATED;
  }
}
