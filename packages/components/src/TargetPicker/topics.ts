import { defineTopicManifest } from "@ksp-gonogo/core";

export const targetPickerTopics = defineTopicManifest({
  channels: ["target.available", "vessel.target"],
});
