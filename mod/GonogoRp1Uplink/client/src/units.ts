// The two unit tokens this Uplink introduces, taught to the client on both
// seams: what they ARE, and how they READ.
//
// The MODEL half is not optional here, and the reason is worth writing down
// because the obvious reading of the guidance gets it wrong. "A token that
// names a category rather than a scale needs only a display registration" is
// true of RENDERING and false of DECODING: `wrapTopicPayload` skips any field
// whose token has no model entry, on the grounds that it is a flag or an id
// rather than a quantity. Registered on the display seam alone, every `bp` and
// `confidence` field would arrive at a widget as a bare number while its
// generated type still said `Value<"bp">`, and `<Unit>` would be handed a
// number it cannot render. Measured, not assumed: the decode assertions in
// `topics.test.ts` fail exactly that way with these three calls removed.
//
// Each gets its OWN dimension base, which is the same shape core gives `funds`,
// `science`, `rep` and `count`. Normally inventing a private axis is the wrong
// move, because it makes a quantity an island nothing can convert with. Here
// that is the accurate model: a build point converts to nothing, and Confidence
// is a sibling of funds rather than a multiple of anything.
//
// The DISPLAY half carries no ladder, because neither token has rungs to climb.
import { registerUnit } from "@ksp-gonogo/sitrep-sdk";
import { registerUnit as registerDisplayUnit } from "@ksp-gonogo/ui-kit";

/** RP-1's internal work quantity: what a project takes, not how long it takes. */
registerUnit({
  symbol: "bp",
  kind: "buildPoints",
  dimension: { bp: 1 },
  ratio: 1,
});

/** The rate progress actually advances at, and the reason the ETA is derivable. */
registerUnit({
  symbol: "bp/s",
  kind: "buildRate",
  dimension: { bp: 1, s: -1 },
  ratio: 1,
});

/** RP-1's own currency, earned from science and spent on programmes and leaders. */
registerUnit({
  symbol: "confidence",
  kind: "confidence",
  dimension: { confidence: 1 },
  ratio: 1,
});

registerDisplayUnit({ symbol: "bp", kind: "count" });
registerDisplayUnit({ symbol: "bp/s", kind: "count" });
registerDisplayUnit({ symbol: "confidence", kind: "count" });
