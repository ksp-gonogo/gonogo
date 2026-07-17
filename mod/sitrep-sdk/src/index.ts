export * from "./__generated__/contract";
// The curated author-facing barrel (registration + hook shims + author types).
// PROPOSAL surface pending operator sign-off (design D-D) before first external
// publish. See ./api for why these are host-injected shims, not core re-exports.
export * from "./api";
export { parseServerMessage } from "./client";
export * from "./envelope";
export {
  isTopicId,
  TOPIC_IDS,
  type TopicId,
  type TopicPayload,
  type TopicPayloadMap,
} from "./topics";
export { SDK_VERSION } from "./version.generated";
