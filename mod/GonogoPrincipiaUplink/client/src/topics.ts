import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
} from "@ksp-gonogo/sitrep-sdk";
import type { PrincipiaFlightPlan } from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
} from "./__generated__/units";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "principia.flightPlan": PrincipiaFlightPlan;
  }
}

registerBarePrimitiveTopic("principia.flightPlan");

// The runtime half of the type above: `ApplyUnitValueTypes` fixes the
// codegen-time TYPE, and this fixes the decode-time VALUE. Without it every
// instant and Δv on the payload arrives as a bare number while the type still
// says `Value<"ut">`, which is the kind of disagreement nothing fails on.
registerTopicUnits(
  "principia.flightPlan",
  GENERATED_TOPIC_UNITS["principia.flightPlan"] ?? {},
  GENERATED_TOPIC_SHAPES["principia.flightPlan"] ?? {},
);
