import { defineTopicManifest } from "@ksp-gonogo/core";

export const vesselCatalogTopics = defineTopicManifest({
  channels: [
    "trackingStation.catalog",
    "trackingStation.bodies",
    "commandCentre.roster",
  ],
});
