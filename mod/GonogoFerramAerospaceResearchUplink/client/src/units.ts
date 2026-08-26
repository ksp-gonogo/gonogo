// The two unit tokens this Uplink introduces, taught to the client on both
// seams: what they ARE, and how they READ.
//
// The MODEL half is not optional, and the reason is easy to get wrong: a token
// with no model entry is not treated as a quantity at all. `wrapTopicPayload`
// skips any field whose token it cannot model, on the grounds that it is a flag
// or an id, so registered on the display seam alone every ballistic coefficient
// and specific excess power would arrive at a widget as a bare number while its
// generated type still said `Value<"kg/m²">`, and `<Unit>` would be handed a
// number it cannot render. `topics.test.ts` decodes a real frame and goes red
// exactly that way with these two calls removed.
//
// Both dimension onto the EXISTING kilogram, metre and second bases rather than
// inventing a private axis, because both genuinely convert: an areal density is
// a mass over an area, and a specific power is a power over a mass. That keeps a
// ballistic coefficient in the same algebra as the areas and densities already
// on the wire, which a private axis would have cut it off from.
//
// The DISPLAY half carries no ladder. Neither token has rungs an operator
// reads: a ballistic coefficient lives in the hundreds and a specific excess
// power in the tens, across the whole range of craft either describes, so there
// is nothing to climb and a kilo-prefix on either would be noise.
import { registerUnit } from "@ksp-gonogo/sitrep-sdk";
import { registerUnit as registerDisplayUnit } from "@ksp-gonogo/ui-kit";

/** Mass over the area presenting it to the airflow: what decides an entry's corridor. */
registerUnit({
  symbol: "kg/m²",
  kind: "arealDensity",
  dimension: { kg: 1, m: -2 },
  ratio: 1,
});

/** Thrust less drag, per unit mass, at the current speed. */
registerUnit({
  symbol: "W/kg",
  kind: "specificPower",
  dimension: { m: 2, s: -3 },
  ratio: 1,
});

registerDisplayUnit({ symbol: "kg/m²", kind: "arealDensity" });
registerDisplayUnit({ symbol: "W/kg", kind: "specificPower" });
