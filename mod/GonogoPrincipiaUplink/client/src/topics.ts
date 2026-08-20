import {
  registerBarePrimitiveTopic,
  registerTopicUnits,
  registerTypeUnits,
} from "@ksp-gonogo/sitrep-sdk";
import type {
  PrincipiaFlightPlan,
  PrincipiaProvenance,
} from "./__generated__/contract";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
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

// The TYPE-keyed half, and it is not optional here: `principia.flightPlan`
// nests, so `wrapTopicPayload` learns from the topic's shape map that `burns`
// holds another type and then resolves that type BY NAME through the type-keyed
// registry. Registering only the topic left every burn's Δv and duration arriving
// bare while the generated type still said `Value<"m/s">`, and the widget's own
// `<Unit>` rendered a null dash for both. Nothing failed: the tests asserted the
// row labels and the badges, and a render is what showed the empty columns.
for (const [typeName, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(typeName, units, GENERATED_TYPE_SHAPES[typeName] ?? {});
}
