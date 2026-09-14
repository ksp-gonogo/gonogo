// The unit tokens this Uplink introduces, declared once to the type system and
// registered once with the runtime.
//
// The registration is not optional, and the reason is worth writing down because
// the obvious reading gets it wrong. "A token that names a category rather than a
// scale needs nothing but a display rule" is true of RENDERING and false of
// DECODING: `wrapTopicPayload` skips any field whose token has no model entry, on
// the grounds that it is a flag or an id rather than a quantity. Without these
// calls every `bp` and `confidence` field would arrive at a widget as a bare number
// while its generated type still said `Value<"bp">`, and `<Unit>` would be handed a
// number it cannot render. Measured, not assumed: the decode assertions in
// `topics.test.ts` fail exactly that way with these calls removed.
//
// The reasoning that got this wrong the first time is worth keeping, because it is
// reasonable and the next person declaring a non-converting unit will follow it: "a
// dimension is a claim that a quantity converts, and neither of these converts to
// anything, so neither should have one". Sound about dimensions, false about the
// mechanism. The model entry is also what marks a token as a QUANTITY at all.
//
// Each gets its OWN dimension base, which is the same shape core gives `funds`,
// `science`, `rep` and `count`. Inventing a private axis is usually the wrong move,
// because it makes a quantity an island nothing can convert with. Here that is the
// accurate model: a build point converts to nothing, and Confidence is a sibling of
// funds rather than a multiple of anything.
//
// None of them climbs a ladder, and each reads the way a count does: whole, with no
// symbol beside the number, because the row it sits in already names it.
import { registerUnit } from "@ksp-gonogo/sitrep-sdk";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface UnitDeclarations {
    bp: { kind: "buildPoints"; dim: { readonly bp: 1 }; ratio: 1 };
    "bp/s": {
      kind: "buildRate";
      dim: { readonly bp: 1; readonly s: -1 };
      ratio: 1;
    };
    confidence: {
      kind: "confidence";
      dim: { readonly confidence: 1 };
      ratio: 1;
    };
  }
}

/** Every unit symbol this Uplink declares, for a guard that looks for them typed by hand. */
export const RP1_UNIT_SYMBOLS = ["bp", "bp/s", "confidence"] as const;

/** RP-1's internal work quantity: what a project takes, not how long it takes. */
registerUnit({
  symbol: "bp",
  kind: "buildPoints",
  dimension: { bp: 1 },
  ratio: 1,
  decimals: 0,
  display: "",
});

/** The rate progress actually advances at, and the reason the ETA is derivable. */
registerUnit({
  symbol: "bp/s",
  kind: "buildRate",
  dimension: { bp: 1, s: -1 },
  ratio: 1,
  decimals: 0,
  display: "",
});

/** RP-1's own currency, earned from science and spent on programmes and leaders. */
registerUnit({
  symbol: "confidence",
  kind: "confidence",
  dimension: { confidence: 1 },
  ratio: 1,
  decimals: 0,
  display: "",
});
