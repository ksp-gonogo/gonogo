import { defineTopicManifest } from "@ksp-gonogo/core";

export const fleetRosterTopics = defineTopicManifest({
  channels: ["system.vessels", "system.bodies", "commandCentre.roster"],
});
