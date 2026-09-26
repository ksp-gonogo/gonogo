import { defineTopicManifest } from "@ksp-gonogo/core";

export const librationPointsTopics = defineTopicManifest({
  channels: ["system.bodies"],
  optionalChannels: ["vessel.orbit", "vessel.identity"],
});
