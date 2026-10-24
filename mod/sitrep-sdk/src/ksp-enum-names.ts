import {
  KspActionGroup,
  KspEditorFacility,
  KspParameterState,
  KspPartCategory,
  KspResourceFlowMode,
  KspRosterStatus,
  KspSpaceCenterFacility,
} from "./__generated__/contract";
import { namesByValue } from "./enum-names";

/**
 * Value→name tables and closed name unions for KSP's own enums, derived from
 * the generated mirrors in `Sitrep.Contract/KspEnums.cs`.
 *
 * These exist for the same reason `contract-enum-names.ts`'s `SituationName`
 * and friends do. A KSP enum reaching the client as a bare `.ToString()` name typed
 * `string` lets a comparison against any literal at all compile, including a
 * literal no version of KSP has ever emitted. Typed as the union below, such a
 * comparison is TS2367 and the error lists the members that are valid.
 *
 * Every table here is a `namesByValue` map rather than the ordinal-indexed
 * array `namesOf` produces, uniformly, even for the enums that happen to be
 * dense. Two of these genuinely need it (`KspPartCategory` opens at `none =
 * -1`, `KspActionGroup` is a `[Flags]` bitmask), and picking per-enum would put
 * a judgement call in front of whoever adds the eighth: get it wrong on a
 * sparse enum and the table silently comes out short, which is the
 * `TARGET_KIND_NAMES` defect. One shape has no wrong answer.
 *
 * The union is what stops a bad comparison compiling; the mirror test in
 * `Gonogo.KSP.Tests` is what stops the union going stale against KSP itself.
 * Neither substitutes for the other: the compiler cannot see KSP's declaration,
 * and the mirror test cannot see a consumer's `===`.
 */

/**
 * KSP's `ProtoCrewMember.RosterStatus`, as the `situationOrdinal` of a
 * `spaceCenter.crewRoster[]` entry carries it. A map from each value to its
 * member name: `KSP_ROSTER_STATUS_NAMES.get(0)` is `"Available"`, and a value the
 * table does not know gives `undefined`. `situationOrdinal` reads `Available`
 * for a kerbal who is resting after a flight, so do not branch on it to decide
 * whether a kerbal can fly: use `CrewRosterEntry.standing`. Useful for showing the operator a kerbal's
 * roster status by name.
 *
 * @category Enum names
 */
export const KSP_ROSTER_STATUS_NAMES = namesByValue(KspRosterStatus);
/**
 * The name of a `KspRosterStatus` member. Useful for typing a comparison against
 * a kerbal's roster status so a name KSP never emits does not compile.
 *
 * @category Enum names
 */
export type KspRosterStatusName = keyof typeof KspRosterStatus;

/**
 * KSP's `Contracts.ParameterState`, as a contract's objective rows carry it. A map from each
 * value to its member name. Useful for showing the operator whether each objective
 * of a contract is complete, failed or still open.
 *
 * @category Enum names
 */
export const KSP_PARAMETER_STATE_NAMES = namesByValue(KspParameterState);
/**
 * The name of a `KspParameterState` member. Useful for typing a comparison
 * against a contract objective's state.
 *
 * @category Enum names
 */
export type KspParameterStateName = keyof typeof KspParameterState;

/**
 * KSP's `PartCategories`, as `vessel.parts[]` entries carry it. A map from each value
 * to its member name; it includes `none = -1`. Useful for showing the operator which category a part
 * of the vessel belongs to.
 *
 * @category Enum names
 */
export const KSP_PART_CATEGORY_NAMES = namesByValue(KspPartCategory);
/**
 * The name of a `KspPartCategory` member. Useful for typing a comparison against
 * a part's category.
 *
 * @category Enum names
 */
export type KspPartCategoryName = keyof typeof KspPartCategory;

/**
 * KSP's `KSPActionGroup`, as a part action's bindings carry it. A bitmask, so a
 * part action bound to several groups holds several members' values added
 * together and has no single entry here: read a value with
 * {@link actionGroupNames}, which splits it, rather than looking it up here.
 * This table is for naming one group. Useful for showing the operator the name of an
 * action group. Used by the alarms editor.
 *
 * @category Enum names
 */
export const KSP_ACTION_GROUP_NAMES = namesByValue(KspActionGroup);
/**
 * The name of a `KspActionGroup` member. Useful for typing a comparison against
 * the action groups a part action is bound to.
 *
 * @category Enum names
 */
export type KspActionGroupName = keyof typeof KspActionGroup;

/**
 * KSP's `EditorFacility`, as `spaceCenter.savedShips[]` entries carry it. A map
 * from each value to its member name. Useful for showing the operator which
 * building, the vehicle assembly or the spaceplane hangar, a saved ship was
 * built in. Used by the launch director widget.
 *
 * @category Enum names
 */
export const KSP_EDITOR_FACILITY_NAMES = namesByValue(KspEditorFacility);
/**
 * The name of a `KspEditorFacility` member. Useful for typing a comparison
 * against the building a saved ship was built in.
 *
 * @category Enum names
 */
export type KspEditorFacilityName = keyof typeof KspEditorFacility;

/**
 * KSP's `SpaceCenterFacility`, as the `facilityOrdinal` of an entry of the
 * `career.facilities` Topic carries it. A map from each value to its member name. Useful for showing the operator the name of each
 * space centre building.
 *
 * @category Enum names
 */
export const KSP_SPACE_CENTER_FACILITY_NAMES = namesByValue(
  KspSpaceCenterFacility,
);
/**
 * The name of a `KspSpaceCenterFacility` member. Useful for typing a comparison
 * against a space centre building.
 *
 * @category Enum names
 */
export type KspSpaceCenterFacilityName = keyof typeof KspSpaceCenterFacility;

/**
 * KSP's `ResourceFlowMode`, as resource definitions carry it. A map from each value to
 * its member name. Useful for showing the operator how a resource flows between
 * the parts of a vessel.
 *
 * @category Enum names
 */
export const KSP_RESOURCE_FLOW_MODE_NAMES = namesByValue(KspResourceFlowMode);
/**
 * The name of a `KspResourceFlowMode` member. Useful for typing a comparison
 * against a resource's flow mode.
 *
 * @category Enum names
 */
export type KspResourceFlowModeName = keyof typeof KspResourceFlowMode;

/**
 * Every name table for one of KSP's own enums in this file, such as
 * {@link KSP_ROSTER_STATUS_NAMES}, each with the enum it names. Useful for code that checks or lists all the
 * tables at once.
 *
 * @category Enum names
 */
// enum-name-tables.test.ts checks each table matches its enum and that every generated Ksp* enum has one.
export const KSP_ENUM_NAME_TABLES: ReadonlyArray<{
  /** The table's exported name, such as `"KSP_ROSTER_STATUS_NAMES"`. */
  label: string;
  /** The generated enum the table is built from, such as `KspRosterStatus`. */
  members: object;
  /** The table itself: each value of the enum mapped to its member name. */
  names: ReadonlyMap<number, string>;
}> = [
  {
    label: "KSP_ROSTER_STATUS_NAMES",
    members: KspRosterStatus,
    names: KSP_ROSTER_STATUS_NAMES,
  },
  {
    label: "KSP_PARAMETER_STATE_NAMES",
    members: KspParameterState,
    names: KSP_PARAMETER_STATE_NAMES,
  },
  {
    label: "KSP_PART_CATEGORY_NAMES",
    members: KspPartCategory,
    names: KSP_PART_CATEGORY_NAMES,
  },
  {
    label: "KSP_ACTION_GROUP_NAMES",
    members: KspActionGroup,
    names: KSP_ACTION_GROUP_NAMES,
  },
  {
    label: "KSP_EDITOR_FACILITY_NAMES",
    members: KspEditorFacility,
    names: KSP_EDITOR_FACILITY_NAMES,
  },
  {
    label: "KSP_SPACE_CENTER_FACILITY_NAMES",
    members: KspSpaceCenterFacility,
    names: KSP_SPACE_CENTER_FACILITY_NAMES,
  },
  {
    label: "KSP_RESOURCE_FLOW_MODE_NAMES",
    members: KspResourceFlowMode,
    names: KSP_RESOURCE_FLOW_MODE_NAMES,
  },
];

/**
 * Returns the names of the action groups set in a `KSPActionGroup` bitmask, in
 * KSP's order. `None` and `REPLACEWITHDEFAULT` are KSP's placeholder values,
 * not action groups, and are never included. Returns an
 * empty array for no mask. Useful for showing the operator which action groups
 * a part action is bound to.
 *
 * @category Enum names
 */
export function actionGroupNames(mask: number | null | undefined): string[] {
  if (mask == null) return [];
  const names: string[] = [];
  for (const [value, name] of KSP_ACTION_GROUP_NAMES) {
    if (value > 0 && (mask & value) === value) names.push(name);
  }
  return names;
}
