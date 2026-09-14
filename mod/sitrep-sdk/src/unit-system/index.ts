// The two augmentable interfaces are exported for one reason: `declare module`
// merges into what a module EXPORTS, so an interface the package entry does not
// name cannot be augmented through the package name. Left out, the documented
// spelling still compiles and silently declares a second, unrelated interface.
export type { ResourceNamespaces } from "./algebra";
export {
  calendarRatio,
  isCalendarUnit,
  type KspCalendar,
  kspCalendar,
  kspYearDays,
  STOCK_KERBIN_CALENDAR,
  setKspCalendar,
} from "./calendar";
export type {
  DeclaredUnit,
  UnitDeclaration,
  UnitDeclarations,
} from "./declarations";
export {
  type KnownUnit,
  STANDARD_GRAVITY,
  UNIT_DEFINITIONS,
  type UnitDefinition,
} from "./definitions";
export * as Dimension from "./dimension";
export { assertGuardsRegistered, isUnit, unitGuard } from "./guards";
export {
  affineVectorUnitFor,
  declaredUnitFor,
  displaySymbol,
  lookupUnit,
  namespaceOf,
  onUnitRegistered,
  type RegisteredUnit,
  registerUnit,
  resetUnitRegistry,
  type UnitPresentation,
  type UnitRegistration,
  type UnitRung,
} from "./registry";
export {
  hydrate,
  isValue,
  type PointUnit,
  type SameDimensionAs,
  type UnknownUnit,
  type Value,
  type Vector3,
  value,
  vectorMagnitude,
} from "./value";
