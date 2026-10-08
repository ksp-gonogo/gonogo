import { registerComponent } from "@ksp-gonogo/core";
import type { TinyEssential } from "@ksp-gonogo/sitrep-sdk";
import { CrewStatusComponent } from "./CrewStatusView";
import type { CrewStatusConfig } from "./config";
import read from "./crew-status.declarations.g";
import { crewStatusTopics } from "./topics";
// Registers the header headcount badge.
import "./badge";
import "./slots";

export type {
  CrewAvatarContext,
  CrewBadgeContext,
  CrewRowToneEntry,
} from "./slots";

/** Who is aboard against room for them. */
function useCrewEssentials(): readonly TinyEssential[] {
  const crew = crewStatusTopics.useTelemetry("vessel.crew");
  return [
    { label: "Aboard", value: crew.count },
    { label: "Capacity", value: crew.capacity },
  ];
}

registerComponent<CrewStatusConfig>({
  id: "crew-status",
  name: "Crew Status",
  description:
    "The kerbals aboard your active vessel and how many seats are filled, including the kerbal you are flying on EVA.",
  tags: ["telemetry", "crew"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 4, h: 5 },
  component: CrewStatusComponent,
  tiny: {
    title: "CREW",
    useEssentials: useCrewEssentials,
  },
  augmentSlots: [
    "crew-status.row-badges",
    "crew-status.avatar",
    "crew-status.summary",
  ],
  contributionSlots: ["crew-status.row-tone", "crew-status.meters"],
  channels: crewStatusTopics.channels,
  fields: crewStatusTopics.fields,
  ...read,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CrewStatusComponent };
