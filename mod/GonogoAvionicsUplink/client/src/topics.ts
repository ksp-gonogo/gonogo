import { registerBarePrimitiveTopic } from "@ksp-gonogo/sitrep-sdk";

// The bare TrueNow presence primitive is declared client-side (it has no
// [SitrepTopic] contract type: see the SDK topics.ts header). avionics.status
// is the structured Topic, declared in C# + codegen.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "avionics.available": boolean;
  }
}

registerBarePrimitiveTopic("avionics.available");
