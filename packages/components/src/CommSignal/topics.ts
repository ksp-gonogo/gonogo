import { defineTopicManifest } from "@ksp-gonogo/core";

export const commSignalTopics = defineTopicManifest({
  channels: ["comms.link", "vessel.comms", "comms.delay"],
  fields: [
    "comms.link.connected",
    "vessel.comms.signalStrength",
    "vessel.comms.controlState",
    "comms.delay.oneWaySeconds",
  ],
});
