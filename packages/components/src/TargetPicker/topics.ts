import { defineTopicManifest } from "@ksp-gonogo/core";
import read from "./target-picker.declarations.g";

export const targetPickerTopics = defineTopicManifest({
  channels: ["target.available", "vessel.target"],
  optionalChannels: read.optionalChannels,
});
