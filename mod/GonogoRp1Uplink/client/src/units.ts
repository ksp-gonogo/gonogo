// The two unit tokens this Uplink introduces, taught to the client.
//
// Both name a CATEGORY rather than a scale, so both get the display half only,
// with `kind: "count"` and no ladder: that is the documented shape for a token
// with no rungs to climb. Neither gets a model registration, and that is the
// deliberate half of the decision rather than an omission. `registerUnit` is
// where a dimension and a ratio go, and a dimension is a claim that a quantity
// CONVERTS: bits and bytes share one because a link budget and a file size are
// the same physical thing measured differently. RP-1 build points convert to
// nothing, and Confidence converts to nothing. Giving either a private axis
// would make it an island the arithmetic cannot use anyway, while implying it
// is comparable with something.
//
// `bp/s` needs no registration of its own. A compound is declared once both
// halves are, and the client already knows seconds.
import { registerUnit as registerDisplayUnit } from "@ksp-gonogo/ui-kit";

/** RP-1's internal work quantity: what a project takes, not how long it takes. */
registerDisplayUnit({ symbol: "bp", kind: "count" });

/** RP-1's own currency, a sibling of funds and science rather than a multiple of either. */
registerDisplayUnit({ symbol: "confidence", kind: "count" });
