// The three units this Uplink brings with it, declared once to the type system and
// registered once with the runtime.
//
// Kerbalism measures science data in megabytes, not stock's mits, and none of the
// three symbols below is in the first-party catalog. Without the registrations a
// symbol can be carried but never wrapped (`wrapTopicPayload` skips a token the
// model does not know, treating it as a non-quantity), so every `MB` figure in a
// namespace would arrive as a bare number while the generated type still said
// `Value<"MB">`. Without the declarations, every `<Unit format>` over one of them
// would accept nothing, because the compiler would have no kind to check it against.
//
// Dimensioned onto the model's real `bit`, not given a private dimension of its own:
// that is what makes a Kerbalism file size commensurable with an antenna's `bit/s`
// budget instead of being an island. 1 MB = 8e6 bit (SI mega, decimal), matching how
// the catalog already scales `Mbit/s`. Mits deliberately stay their own dimension in
// the first-party catalog, because a mit is a game abstraction with no byte count,
// which is the whole reason the two cannot share a field.
import { registerUnit } from "@ksp-gonogo/sitrep-sdk";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface UnitDeclarations {
    MB: {
      kind: "data";
      dim: { readonly bit: 1 };
      ratio: 8_000_000;
      ladder: "bytes";
    };
    "MB/s": {
      kind: "dataRate";
      dim: { readonly bit: 1; readonly s: -1 };
      ratio: 8_000_000;
      ladder: "byteRate";
    };
    "science/MB": {
      kind: "scienceDensity";
      dim: { readonly science: 1; readonly bit: -1 };
      ratio: number;
    };
  }
}

/** Every unit symbol this Uplink declares, for a guard that looks for them typed by hand. */
export const KERBALISM_UNIT_SYMBOLS = ["MB", "MB/s", "science/MB"] as const;

/**
 * The byte ladder and its rungs, which belong here rather than in core: core owns
 * the data dimension's base so a drive's bytes and an antenna's bits stay
 * convertible, and each mod declares the units it actually models. Decimal, because
 * Kerbalism's own source is (`BPerMB = 1000*1000`), so these agree with the figures
 * the game's own UI shows rather than drifting per tier.
 *
 * A ladder of its own is what keeps bytes off the bit rungs: both are `data`, so
 * laddering on kind alone would let whichever mod registered last re-scale the
 * other's readouts. A rate gets its rungs the same way, so a transmit speed reads
 * 4 kB/s rather than the 32 kbit/s a shared ladder would produce.
 */
const BYTE_RUNGS = [
  { from: 8, symbol: "B", per: 8 },
  { from: 8e3, symbol: "kB", per: 8e3 },
  { from: 8e6, symbol: "MB", per: 8e6 },
  { from: 8e9, symbol: "GB", per: 8e9 },
] as const;

const BYTE_RATE_RUNGS = [
  { from: 8, symbol: "B/s", per: 8 },
  { from: 8e3, symbol: "kB/s", per: 8e3 },
  { from: 8e6, symbol: "MB/s", per: 8e6 },
  { from: 8e9, symbol: "GB/s", per: 8e9 },
] as const;

registerUnit({
  symbol: "MB",
  kind: "data",
  dimension: { bit: 1 },
  ratio: 8e6,
  ladder: "bytes",
  rungs: BYTE_RUNGS,
});
registerUnit({
  symbol: "MB/s",
  kind: "dataRate",
  dimension: { bit: 1, s: -1 },
  ratio: 8e6,
  ladder: "byteRate",
  rungs: BYTE_RATE_RUNGS,
});
registerUnit({
  symbol: "science/MB",
  kind: "scienceDensity",
  dimension: { science: 1, bit: -1 },
  ratio: 1 / 8e6,
});
