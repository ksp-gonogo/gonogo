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
export {
  type KnownSitrepUnit,
  type SitrepUnit,
  type UnitsByField,
  unitOf,
  unitOfTypeField,
  unitsForTopic,
  unitsForType,
} from "./units";
export { SDK_VERSION } from "./version.generated";
