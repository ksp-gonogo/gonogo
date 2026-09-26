import { defineTopicManifest } from "@ksp-gonogo/core";

export const crewStatusTopics = defineTopicManifest({
  channels: ["vessel.crew", "vessel.identity"],
  optionalChannels: ["vessel.resources"],
  fields: [
    "vessel.crew.crew",
    "vessel.crew.count",
    "vessel.crew.capacity",
    "vessel.identity.vesselType",
  ],
});
