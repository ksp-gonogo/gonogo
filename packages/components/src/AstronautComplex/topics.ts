import { defineTopicManifest } from "@ksp-gonogo/core";

export const astronautComplexTopics = defineTopicManifest({
  channels: [
    "spaceCenter.astronautComplex",
    "spaceCenter.crewRoster",
    "career.status",
  ],
  // Funds is the only thing drawn off `career.status`.
  fields: [
    "spaceCenter.astronautComplex",
    "spaceCenter.crewRoster",
    "career.status.balances.funds",
  ],
});
