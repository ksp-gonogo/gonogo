import {
  ControlState,
  SasMode,
  Situation,
  TargetKind,
} from "./__generated__/contract";
import { namesOf } from "./enum-names";

/*
 * Name tables for the contract's own enums, derived from the generated enums so a member added in C# reaches them.
 * Shared rather than per widget: a hand-written three-entry TargetKind table once resolved new members to undefined.
 */

/**
 * The name of a `Situation` member, such as `Orbiting`. Comparing a name with
 * a string that is not a member does not compile. Useful for showing the operator
 * a vessel's situation by name. Used by the science data widget with
 * {@link SITUATION_NAMES}.
 *
 * @category Enum names
 */
export type SituationName = keyof typeof Situation;
/**
 * The name of a `SasMode` member, such as `Prograde`. Useful for showing the
 * operator which autopilot mode a vessel is holding. Used by the navball widget.
 *
 * @category Enum names
 */
export type SasModeName = keyof typeof SasMode;
/**
 * The name of a `TargetKind` member. Useful for showing the operator what kind
 * of object the vessel has targeted.
 *
 * @category Enum names
 */
export type TargetKindName = keyof typeof TargetKind;
/**
 * The name of a `ControlState` member. Useful for showing the operator how much
 * control the command centre has over a vessel. Used by the signal verdict of
 * the comms signal widget.
 *
 * @category Enum names
 */
export type ControlStateName = keyof typeof ControlState;

/**
 * The name of each `Situation` value, by its number, as
 * `vessel.identity.situation` carries it. Read it with {@link enumNameOf}.
 * Useful for showing the operator a vessel's situation by name. Used by the
 * science data widget.
 *
 * @category Enum names
 */
export const SITUATION_NAMES = namesOf(Situation);

/**
 * The name of each `SasMode` value, by its number, as `vessel.control.sasMode`
 * carries it: KSP's autopilot modes, plus `Unknown`. Read it with
 * {@link enumNameOf}. Useful for showing the operator the autopilot mode by
 * name. Used by the navball widget.
 *
 * @category Enum names
 */
export const SAS_MODE_NAMES = namesOf(SasMode);

/**
 * The name of each `TargetKind` value, by its number, as `vessel.target.kind`
 * carries it. Read it with {@link enumNameOf}. Useful for showing the operator
 * what kind of object the vessel has targeted.
 *
 * @category Enum names
 */
export const TARGET_KIND_NAMES = namesOf(TargetKind);

/**
 * The name of each `ControlState` value, by its number, as
 * `vessel.comms.controlState` carries it. Read it with {@link enumNameOf}.
 * Useful for showing the operator how much control the command centre has over
 * a vessel. Used by the comms signal widget.
 *
 * @category Enum names
 */
export const CONTROL_STATE_NAMES = namesOf(ControlState);

/**
 * Every name table for an enum Gonogo defines itself ({@link SITUATION_NAMES},
 * {@link SAS_MODE_NAMES}, {@link TARGET_KIND_NAMES} and
 * {@link CONTROL_STATE_NAMES}), each with the enum it names. Useful for code
 * that checks or lists all the tables at once.
 *
 * @category Enum names
 */
// enum-name-tables.test.ts checks each table still matches its enum.
export const ENUM_NAME_TABLES: ReadonlyArray<{
  /** The table's exported name, such as `"SITUATION_NAMES"`. */
  label: string;
  /** The enum the table is built from, such as `Situation`. */
  members: object;
  /** The table itself: the name of each member, indexed by its value. */
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
 * Returns the name at `ordinal` in a name table, or `undefined` for a number
 * the table does not have, such as a member added in a newer mod version.
 * Show nothing for `undefined`, as for a value that has not arrived. Useful for
 * showing the operator a numbered enum from the stream by name. Used by the
 * navball and science data widgets.
 *
 * @category Enum names
 * @categoryDescription Enum names
 * The names behind the numbered enums the stream sends, KSP's and Gonogo's
 * own, so a widget can show or switch on a name instead of an ordinal.
 */
export function enumNameOf<EnumName extends string>(
  names: readonly string[],
  ordinal: number | null | undefined,
): EnumName | undefined {
  if (ordinal == null) return undefined;
  return (names[ordinal] as EnumName | undefined) ?? undefined;
}

/**
 * The control level of each `ControlState` value, by its number: 2 for full
 * control, 1 for partial, 0 for none, and `undefined` for `Unknown`. Read it
 * with {@link collapseControlStateLevel}. Useful for reducing the eleven
 * control states to the three levels the operator acts on.
 *
 * @category Enum names
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
 * Returns the control level for a `vessel.comms.controlState` value: 2 for
 * full control, 1 for partial, 0 for none, or `undefined` for `Unknown` or a
 * number this version does not know. Useful for showing the operator whether the
 * command centre can control a vessel fully, partly or not at all. Used by the
 * navball widget and the signal loss indicator.
 *
 * @category Enum names
 */
export function collapseControlStateLevel(
  controlState: number,
): number | undefined {
  return CONTROL_STATE_LEVEL[controlState] ?? undefined;
}
