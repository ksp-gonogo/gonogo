import { defineTopicManifest } from "@ksp-gonogo/core";

export const contractManagerTopics = defineTopicManifest({
  channels: ["career.status"],
  fields: [
    "career.status.contracts.active",
    "career.status.contracts.offered",
    "career.status.contracts.completedRecent",
  ],
});
