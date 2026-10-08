import { defineTopicManifest } from "@ksp-gonogo/core";
import read from "./comm-signal.declarations.g";

export const commSignalTopics = defineTopicManifest({
  channels: ["comms.link", "vessel.comms", "comms.signal", "comms.delay"],
  optionalChannels: read.optionalChannels,
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
