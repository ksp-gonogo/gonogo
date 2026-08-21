import {
  KspActionGroup,
  KspEditorFacility,
  KspParameterState,
  KspPartCategory,
  KspResourceFlowMode,
  KspRosterStatus,
  KspSpaceCenterFacility,
} from "../__generated__/contract";
import { namesByValue } from "./enum-names";

/**
 * Value→name tables and closed name unions for KSP's OWN enums, derived from
 * the generated mirrors in `Sitrep.Contract/KspEnums.cs`.
 *
 * These exist for the same reason `vessel-state.ts`'s `SituationName` and
 * friends do, and they are the half that was missing. A KSP enum used to reach
 * the client as a bare `.ToString()` name typed `string`, so comparing it
 * against any literal at all compiled, including a literal no version of KSP
 * has ever emitted. Typed as the union below, such a comparison is TS2367 and
 * the error lists the members that ARE valid.
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

/** KSP's `ProtoCrewMember.RosterStatus`, behind `spaceCenter.crewRoster[]`. */
export const KSP_ROSTER_STATUS_NAMES = namesByValue(KspRosterStatus);
export type KspRosterStatusName = keyof typeof KspRosterStatus;

/** KSP's `Contracts.ParameterState`, behind a contract's objective rows. */
export const KSP_PARAMETER_STATE_NAMES = namesByValue(KspParameterState);
export type KspParameterStateName = keyof typeof KspParameterState;

/** KSP's `PartCategories`, behind `vessel.parts[]`. Carries `none = -1`. */
export const KSP_PART_CATEGORY_NAMES = namesByValue(KspPartCategory);
export type KspPartCategoryName = keyof typeof KspPartCategory;

/** KSP's `KSPActionGroup`, behind a part action's bindings. A bitmask. */
export const KSP_ACTION_GROUP_NAMES = namesByValue(KspActionGroup);
export type KspActionGroupName = keyof typeof KspActionGroup;

/** KSP's `EditorFacility`, behind `spaceCenter.savedShips[]`. */
export const KSP_EDITOR_FACILITY_NAMES = namesByValue(KspEditorFacility);
export type KspEditorFacilityName = keyof typeof KspEditorFacility;

/** KSP's `SpaceCenterFacility`, behind the career facilities map. */
export const KSP_SPACE_CENTER_FACILITY_NAMES = namesByValue(
  KspSpaceCenterFacility,
);
export type KspSpaceCenterFacilityName = keyof typeof KspSpaceCenterFacility;

/** KSP's `ResourceFlowMode`, behind Kerbalism's resource definitions. */
export const KSP_RESOURCE_FLOW_MODE_NAMES = namesByValue(KspResourceFlowMode);
export type KspResourceFlowModeName = keyof typeof KspResourceFlowMode;

/**
 * Every table above, paired with the enum it must cover.
 *
 * Read by `enum-name-tables.test.ts`, which checks two things: that each table
 * still matches its enum, and that this registry covers every `Ksp*` enum the
 * generated contract exports. The second is the one that catches the mistake
 * this file invites, which is declaring an eighth mirror in C# and never giving
 * the client a table for it.
 */
export const KSP_ENUM_NAME_TABLES: ReadonlyArray<{
  label: string;
  members: object;
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
 * The named groups a `KSPActionGroup` bitmask decodes to, in the order KSP
 * declares them.
 *
 * `None` (0) and `REPLACEWITHDEFAULT` (-1) are excluded: 0 matches every mask
 * under `&` and -1 matches any bit set at all, so including either would report
 * a group on every action. Everything else is included by DERIVATION rather
 * than by a list, which is the point: the mod used to intersect the mask
 * against a hand-written table of the groups somebody had thought of, so a
 * group KSP added was dropped before it reached the wire.
 */
export function actionGroupNames(mask: number | null | undefined): string[] {
  if (mask == null) return [];
  const names: string[] = [];
  for (const [value, name] of KSP_ACTION_GROUP_NAMES) {
    if (value > 0 && (mask & value) === value) names.push(name);
  }
  return names;
}
