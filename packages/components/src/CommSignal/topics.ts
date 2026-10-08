import { defineTopicManifest } from "@ksp-gonogo/core";

export const commSignalTopics = defineTopicManifest({
  channels: ["comms.link", "vessel.comms", "comms.signal", "comms.delay"],
  optionalChannels: ["comms.commandCentre", "comms.path", "vessel.identity"],
  fields: [
    "comms.link.connected",
    "vessel.comms.signalStrength",
    "vessel.comms.signalQuantity",
    "comms.signal.strength",
    "comms.signal.quantity",
    "comms.signal.modelled",
    "comms.signal.otherPath",
    "comms.signal.measuredPath.nodes",
    "vessel.comms.controlState",
    "comms.delay.oneWaySeconds",
  ],
});
