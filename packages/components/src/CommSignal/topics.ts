import { defineTopicManifest } from "@ksp-gonogo/core";

export const commSignalTopics = defineTopicManifest({
  channels: ["comms.link", "vessel.comms", "comms.signal", "comms.delay"],
  fields: [
    "comms.link.connected",
    "vessel.comms.signalStrength",
    "comms.signal.strength",
    "comms.signal.modelled",
    "comms.signal.otherPath",
    "comms.signal.measuredPath.nodes",
    "vessel.comms.controlState",
    "comms.delay.oneWaySeconds",
  ],
});
