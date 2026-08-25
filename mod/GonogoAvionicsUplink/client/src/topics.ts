import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
} from "@ksp-gonogo/sitrep-sdk";
import type { AvionicsStatus } from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
} from "./__generated__/units";

// The bare TrueNow presence primitive is declared client-side (it has no
// [SitrepTopic] contract type: see the SDK topics.ts header). avionics.status
// is the structured Topic, declared in C# + codegen, but now in THIS Uplink's
// own generated contract (relocated out of Sitrep.Contract: see
// AvionicsPayloads.cs's header comment), not the SDK's.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "avionics.available": boolean;
    "avionics.status": AvionicsStatus;
  }
}

registerBarePrimitiveTopic("avionics.available");
registerBarePrimitiveTopic("avionics.status");

// The runtime half. `AvionicsStatus` lives in THIS Uplink's contract slice, so
// the SDK's own generated unit map knows nothing about it and cannot hydrate
// avionics.status's Value<"t"> fields. This Uplink therefore feeds its own
// generated unit/shape entries into the SDK's runtime registry (see units.ts's
// doc comment on registerTopicUnits). Without it,
// controllableMassTons/vesselMassTons arrive as bare numbers at runtime while
// the TYPE still says Value<"t">.
registerTopicUnits(
  "avionics.status",
  GENERATED_TOPIC_UNITS["avionics.status"] ?? {},
  GENERATED_TOPIC_SHAPES["avionics.status"] ?? {},
);
