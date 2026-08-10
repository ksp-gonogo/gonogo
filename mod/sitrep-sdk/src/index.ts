export * from "./__generated__/contract";
// The curated author-facing barrel (registration + hook shims + author types).
// PROPOSAL surface pending operator sign-off (design D-D) before first external
// publish. See ./api for why these are host-injected shims, not core re-exports.
export * from "./api";
export { parseServerMessage } from "./client";
export {
  type ControlChannelHandle,
  type ControlChannelId,
  controlChannelIds,
  getControlChannel,
} from "./control-channels";
export * from "./envelope";
export {
  getAllKnownTopicIds,
  isTopicId,
  registerBarePrimitiveTopic,
  TOPIC_IDS,
  type TopicId,
  type TopicPayload,
  type TopicPayloadMap,
} from "./topics";
// The unit model: Value, dimensions, arithmetic, the unit table.
//
// This was namespaced as `UnitSystem` while `./value` still aliased `Value` to
// `number` for the generated contract, because two `Value`s could not sit in
// one barrel. The alias now points at the model, so the namespace has served
// its purpose and the members sit flat: a call site writes
// `import { value } from "@ksp-gonogo/sitrep-sdk"` like it does for everything
// else the SDK offers.
//
// `Vec3Of` is the exception and still comes from `./value` below: it is the
// name the generated contract puts on a unit-carrying vector, and there is no
// second spelling of it worth exporting.
export {
  assertGuardsRegistered,
  calendarRatio,
  Dimension,
  declaredUnitFor,
  displaySymbol,
  hydrate,
  isCalendarUnit,
  isValue,
  type KnownUnit,
  type KspCalendar,
  kspCalendar,
  kspYearDays,
  lookupUnit,
  namespaceOf,
  registerUnit,
  resetUnitRegistry,
  type SameDimensionAs,
  STOCK_KERBIN_CALENDAR,
  setKspCalendar,
  UNIT_DEFINITIONS,
  type UnitDefinition,
  type UnitRegistration,
  type UnknownUnit,
  unitGuard,
  type Value,
  type Vector3,
  value,
  vectorMagnitude,
} from "./unit-system";
export {
  type KnownSitrepUnit,
  registerTopicUnits,
  type SitrepUnit,
  type UnitsByField,
  unitOf,
  unitOfTypeField,
  unitsForTopic,
  unitsForType,
} from "./units";
export type { Vec3Of } from "./value";
export { SDK_VERSION } from "./version.generated";
export {
  hydratePayload,
  wrapTopicPayload,
  wrapTypePayload,
} from "./wrap-units";
