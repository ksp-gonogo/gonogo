import { defineTopicManifest } from "@ksp-gonogo/core";
import read from "./crew-status.declarations.g";

export const crewStatusTopics = defineTopicManifest({
  channels: [
    "vessel.crew",
    "vessel.identity",
    "eva.crew",
    "comms.connectivity",
  ],
  optionalChannels: read.optionalChannels,
  fields: [
    "vessel.crew.crew",
    "vessel.crew.count",
    "vessel.crew.capacity",
    "vessel.identity.vesselType",
    "eva.crew.count",
    "eva.crew.kerbals",
    "comms.connectivity.connected",
  ],
});
