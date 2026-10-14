import { defineTopicManifest } from "@ksp-gonogo/core";

export const fleetRosterTopics = defineTopicManifest({
  channels: [
    "trackingStation.catalog",
    "system.bodies",
    "commandCentre.roster",
  ],
});
