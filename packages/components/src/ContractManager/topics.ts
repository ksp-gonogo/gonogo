import { defineTopicManifest } from "@ksp-gonogo/core";

export const contractManagerTopics = defineTopicManifest({
  channels: ["career.status", "vessel.flight"],
  // Without `altitudeAsl` listed the orchestrator never subscribes and AltitudeProgress stays empty.
  fields: [
    "career.status.contracts.active",
    "career.status.contracts.offered",
    "career.status.contracts.completedRecent",
    "vessel.flight.altitudeAsl",
  ],
});
