import { registerComponent } from "@ksp-gonogo/core";
import { CrewStatusComponent } from "./CrewStatusView";
import type { CrewStatusConfig } from "./config";
import { crewStatusTopics } from "./topics";
// Registers the header headcount badge.
import "./badge";
import "./slots";

export type {
  CrewAvatarContext,
  CrewBadgeContext,
  CrewRowToneEntry,
} from "./slots";

registerComponent<CrewStatusConfig>({
  id: "crew-status",
  name: "Crew Status",
  description:
    "Kerbals aboard the active vessel, count vs capacity + full roster. Shows EVA state and handles unmanned probes gracefully.",
  tags: ["telemetry", "crew"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 3 },
  component: CrewStatusComponent,
  augmentSlots: [
    "crew-status.row-badges",
    "crew-status.avatar",
    "crew-status.summary",
  ],
  contributionSlots: ["crew-status.row-tone"],
  channels: crewStatusTopics.channels,
  fields: crewStatusTopics.fields,
  optionalChannels: crewStatusTopics.optionalChannels,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CrewStatusComponent };
