import {
  defineUplinkClient,
  registerAugment,
  registerBarePrimitiveTopic,
  registerComponent,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * A planted Uplink client, written the way an outside author writes one: every
 * registration goes through the published sdk and carries the handle as owner.
 *
 * The cross-Uplink gates in `src/__tests__` iterate whichever first-party
 * Uplink clients are present, and every mod Uplink is leaving for its own repo.
 * Importing this beside them gives each gate one Uplink it can always see, so
 * "found nothing wrong" never quietly becomes "found nothing".
 *
 * Side-effect module: importing it runs every registration once.
 */
export const PLANTED_UPLINK = defineUplinkClient({
  id: "planted",
  version: "0.0.0-dev",
  name: "Planted",
});

/**
 * Also declared as a C# Topic constant by the planted Uplink tree under
 * `mod/Sitrep.Core.Tests/UplinkWalkPlant/`, so the C#-to-registry sync has a
 * pair to agree on when no real Uplink is left.
 */
export const PLANTED_TOPIC = "planted.wiring.topic";

export const PLANTED_WIDGET_ID = "planted-widget";
export const PLANTED_AUGMENT_ID = "planted-augment";

registerBarePrimitiveTopic(PLANTED_TOPIC);

registerComponent({
  id: PLANTED_WIDGET_ID,
  name: "Planted Widget",
  description: "A fixture widget registered by the planted Uplink client.",
  tags: ["telemetry"],
  component: () => null,
  dataRequirements: ["career.status"],
  channels: ["vessel.crew"],
  owner: PLANTED_UPLINK,
});

registerAugment({
  id: PLANTED_AUGMENT_ID,
  augments: "crew-status.row-badges",
  channels: ["vessel.crew"],
  component: () => null,
  owner: PLANTED_UPLINK,
});
