import { defineTopicManifest } from "@ksp-gonogo/core";

export const contractManagerTopics = defineTopicManifest({
  channels: ["career.status", "career.mode"],
  fields: [
    "career.mode",
    "career.status.contracts.active",
    "career.status.contracts.offered",
    "career.status.contracts.completedRecent",
    "career.status.contracts.failedRecent",
    "vessel.flight.altitudeAsl",
  ],
});
