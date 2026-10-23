import { defineTopicManifest } from "@ksp-gonogo/core";

export const astronautComplexTopics = defineTopicManifest({
  channels: [
    "spaceCenter.astronautComplex",
    "spaceCenter.crewRoster",
    "career.status",
    "career.mode",
  ],
  // Funds is the only thing drawn off `career.status`; `career.mode` is sent in every save mode and decides what an empty pool means.
  fields: [
    "spaceCenter.astronautComplex",
    "spaceCenter.crewRoster",
    "career.status.balances.funds",
    "career.mode",
  ],
});
