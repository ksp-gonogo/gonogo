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
// Namespaced only because `./value` still exports a `Value` TYPE aliased to
// `number` for the generated contract, and two `Value`s cannot sit in one
// barrel. When that alias is replaced by the real object, this collapses to a
// flat re-export and the namespace goes.
export * as UnitSystem from "./unit-system";
export {
  type KnownSitrepUnit,
  type SitrepUnit,
  type UnitsByField,
  unitOf,
  unitOfTypeField,
  unitsForTopic,
  unitsForType,
} from "./units";
export type { Value, Vec3Of } from "./value";
export { SDK_VERSION } from "./version.generated";
export { wrapTopicPayload, wrapTypePayload } from "./wrap-units";
