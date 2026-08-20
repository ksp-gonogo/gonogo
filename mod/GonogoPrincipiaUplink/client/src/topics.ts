import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
} from "@ksp-gonogo/sitrep-sdk";
import type {
  PrincipiaFlightPlan,
  PrincipiaProvenance,
} from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
} from "./__generated__/units";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "principia.flightPlan": PrincipiaFlightPlan;
    "principia.provenance": PrincipiaProvenance;
  }
}

registerBarePrimitiveTopic("principia.flightPlan");
registerBarePrimitiveTopic("principia.provenance");

// The runtime half of the type above: `ApplyUnitValueTypes` fixes the
// codegen-time TYPE, and this fixes the decode-time VALUE. Without it every
// instant and Δv on the payload arrives as a bare number while the type still
// says `Value<"ut">`, which is the kind of disagreement nothing fails on.
for (const topic of ["principia.flightPlan", "principia.provenance"] as const) {
  registerTopicUnits(
    topic,
    GENERATED_TOPIC_UNITS[topic] ?? {},
    GENERATED_TOPIC_SHAPES[topic] ?? {},
  );
}
