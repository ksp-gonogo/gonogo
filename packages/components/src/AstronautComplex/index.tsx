import { registerComponent } from "@ksp-gonogo/core";
import { AstronautComplexComponent } from "./AstronautComplexView";
import read from "./astronaut-complex.declarations.g";
import { type AstronautComplexConfig, astronautComplexActions } from "./config";
import {
  ASTRONAUT_COMPLEX_CREW_BADGE_SLOT,
  ASTRONAUT_COMPLEX_READOUTS_SLOT,
  ASTRONAUT_COMPLEX_TAB_SLOT,
} from "./slots";
import { astronautComplexTopics } from "./topics";

export type { AstronautComplexCrewContext } from "./slots";

registerComponent<AstronautComplexConfig>({
  id: "astronaut-complex",
  name: "Astronaut Complex",
  description:
    "Hire applicants and fire kerbals from the Astronaut Complex. Shows your funds, the price of the next hire and how full the roster is, and lists every kerbal by status with their trait, courage, stupidity, rank and experience.",
  tags: ["career", "crew", "kc"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 4 },
  component: AstronautComplexComponent,
  channels: astronautComplexTopics.channels,
  ...read,
  fields: astronautComplexTopics.fields,
  defaultConfig: {},
  actions: astronautComplexActions,
  augmentSlots: [
    "astronaut-complex.crew",
    ASTRONAUT_COMPLEX_CREW_BADGE_SLOT,
    ASTRONAUT_COMPLEX_TAB_SLOT,
  ],
  contributionSlots: [ASTRONAUT_COMPLEX_READOUTS_SLOT],
  pushable: true,
});

export { AstronautComplexComponent };
