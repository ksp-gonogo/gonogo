import {
  ControlState,
  SasMode,
  Situation,
  TargetKind,
} from "./__generated__/contract";
import { namesOf } from "./enum-names";

/**
 * Value→name tables and closed name unions for THIS contract's own enums,
 * derived from the generated mirrors rather than transcribed beside them.
 *
 * The sibling of `ksp-enum-names.ts`, which does the same for KSP's enums, and
 * deliberately the same shape. The reason a widget needs these is that the wire
 * carries an enum as its ORDINAL: a readout that wants the word has to resolve
 * it, and resolving it against a literal it typed itself is how a comparison
 * against a name no version of the game emits comes to compile.
 *
 * Derived, not transcribed, so a member appended in C# widens the union on the
 * next codegen and any exhaustive `switch` over it stops compiling until
 * somebody rules on it. `enum-name-tables.test.ts` is what holds that: a table
 * rebuilt by hand fails against its enum there.
 *
 * ## One table, not one per reader
 *
 * Four widgets resolve a name from one of these, and each could index a
 * literal array of its own in three lines. It would be three lines each of a
 * rule that has already been got wrong once: `TARGET_KIND_NAMES` was a
 * hand-written three-entry table when `TargetKind` grew `Position` and `Part`,
 * and a docking-port target resolved to `undefined` that every consumer read as
 * "the channel has not arrived". A name table looks too small to share, which
 * is exactly the intuition that put that defect in.
 *
 * What does NOT belong here is the channel-presence question. Whether a read
 * has arrived, is stale, or is a confirmed tombstone is a property of the READ
 * and differs per call site; {@link enumNameOf} takes an ordinal a caller has
 * already got in hand and answers only about the ordinal.
 */

/**
 * The closed set of names each table can produce.
 *
 * A field typed `string` accepts a comparison against any literal at all, which
 * is what let `CommSignal` decide a vessel's link tone by substring-matching
 * `"no signal"` against a `ControlState` name: no member is spelled that, so
 * every craft read healthy, including one with no control. Typed as the union,
 * that line is a compile error, because a closed union and a non-member literal
 * have no overlap.
 */
export type SituationName = keyof typeof Situation;
export type SasModeName = keyof typeof SasMode;
export type TargetKindName = keyof typeof TargetKind;
export type ControlStateName = keyof typeof ControlState;

/** `Sitrep.Contract.Situation`, behind `vessel.identity.situation`. */
export const SITUATION_NAMES = namesOf(Situation);

/**
 * `Sitrep.Contract.SasMode`, behind `vessel.control.sasMode`. Identical to
 * Navball's `SAS_MODES` union (both mirror KSP's `VesselAutopilot.AutopilotMode`),
 * with `Unknown` the graceful fallback not present in `SAS_MODES`.
 */
export const SAS_MODE_NAMES = namesOf(SasMode);

/** `Sitrep.Contract.TargetKind`, behind `vessel.target.kind`. */
export const TARGET_KIND_NAMES = namesOf(TargetKind);

/** `Sitrep.Contract.ControlState`, behind `vessel.comms.controlState`. */
export const CONTROL_STATE_NAMES = namesOf(ControlState);

/**
 * Every derived table above, paired with the enum it must cover.
 *
 * Exported for `enum-name-tables.test.ts`, which is the check that these stay
 * derived: a table rebuilt by hand fails against its enum there.
 */
export const ENUM_NAME_TABLES: ReadonlyArray<{
  label: string;
  members: object;
  names: readonly string[];
}> = [
  { label: "SITUATION_NAMES", members: Situation, names: SITUATION_NAMES },
  { label: "SAS_MODE_NAMES", members: SasMode, names: SAS_MODE_NAMES },
  { label: "TARGET_KIND_NAMES", members: TargetKind, names: TARGET_KIND_NAMES },
  {
    label: "CONTROL_STATE_NAMES",
    members: ControlState,
    names: CONTROL_STATE_NAMES,
  },
];

/**
 * The name at `ordinal`, or `undefined` for an ordinal outside the table.
 *
 * An out-of-range ordinal is a member this build's contract does not carry, so
 * there is no word for it and inventing one would put a literal on screen that
 * no enum contains. The caller sees the same `undefined` it sees for a field
 * that did not arrive, which is correct at the drawing site: in both cases
 * there is no name to write.
 */
export function enumNameOf<N extends string>(
  names: readonly string[],
  ordinal: number | null | undefined,
): N | undefined {
  if (ordinal == null) return undefined;
  return (names[ordinal] as N | undefined) ?? undefined;
}

/**
 * `ControlState` ordinal → the 0/1/2 control-LEVEL scheme a readout branches
 * on. Collapses the 11 richer states onto the three levels: `*Full`/bare
 * source → 2 (full), `*Partial` → 1, `*None`/`None` → 0. `Unknown` (11) →
 * `undefined` (unrecognized). Index-aligned with {@link CONTROL_STATE_NAMES},
 * which is why it sits beside it: the alignment is checked in one file.
 */
export const CONTROL_STATE_LEVEL: readonly (number | undefined)[] = [
  0, // None
  2, // Probe (has probe control → full)
  2, // Kerbal (has crew control → full)
  1, // Partial
  2, // Full
  0, // ProbeNone
  1, // ProbePartial
  2, // ProbeFull
  0, // KerbalNone
  1, // KerbalPartial
  2, // KerbalFull
  undefined, // Unknown
];

/**
 * Collapse a raw `Sitrep.Contract.ControlState` enum ordinal
 * (`vessel.comms.controlState`) to the 0/1/2 control-LEVEL scheme via
 * {@link CONTROL_STATE_LEVEL}. `undefined` for an out-of-range / `Unknown`
 * ordinal. The single source of truth for the collapse, so `CommSignal` and
 * `SignalLossIndicator` share it rather than re-tabulating the mapping.
 */
export function collapseControlStateLevel(
  controlState: number,
): number | undefined {
  return CONTROL_STATE_LEVEL[controlState] ?? undefined;
}
