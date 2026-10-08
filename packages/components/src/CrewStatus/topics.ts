import { defineTopicManifest } from "@ksp-gonogo/core";
import read from "./crew-status.declarations.g";

export const crewStatusTopics = defineTopicManifest({
  channels: ["vessel.crew", "vessel.identity"],
  optionalChannels: read.optionalChannels,
  fields: [
    "vessel.crew.crew",
    "vessel.crew.count",
    "vessel.crew.capacity",
    "vessel.identity.vesselType",
  ],
});
