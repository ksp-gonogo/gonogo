import { registerComponent } from "@ksp-gonogo/core";
import { AstronautComplexComponent } from "./AstronautComplexView";
import { type AstronautComplexConfig, astronautComplexActions } from "./config";
import {
  ASTRONAUT_COMPLEX_CREW_BADGE_SLOT,
  ASTRONAUT_COMPLEX_READOUTS_SLOT,
  ASTRONAUT_COMPLEX_TRAINING_SLOT,
} from "./slots";
import { astronautComplexTopics } from "./topics";

export type { AstronautComplexCrewContext } from "./slots";

registerComponent<AstronautComplexConfig>({
  id: "astronaut-complex",
  name: "Astronaut Complex",
  description:
    "Astronaut Complex: funds, single next-hire cost and the active/max crew cap (unlimited-aware) in a core-stat strip, then Applicants and Active tabs. The strip takes further cells from the astronaut-complex.readouts contribution slot, so the career model running the save can put what IT considers core beside the three vanilla figures, in the same cell treatment and the same row. Applicants shows each candidate through the shared crew-stat row (trait, courage, stupidity) with a per-row arm-then-confirm Hire action disabled when funds are short or the roster is at the facility cap. Active is itself tabbed, one sub-tab per CrewStanding present on the roster (Available/Assigned/Retired/Dead/Missing), each showing name/role/courage/stupidity/rank/experience-toward-next-rank via the shared crew-stat row, plus a RESTING badge for a kerbal standing down after a flight. The Available sub-tab additionally carries an arm-then-confirm Fire action at the end of each identity line (no cost, reversible). Every row exposes an astronaut-complex.crew augment slot so a career-overhaul Uplink can render that kerbal's retirement date, training ETA and lapsing training, and an astronaut-complex.crew-badge slot at the top right of the same card for a mark that has to be read WITH the name while scanning the roster rather than in the block underneath it. An astronaut-complex.training slot adds a whole tab beside Applicants and Active for the courses that career is running.",
  tags: ["career", "crew", "kc"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 4 },
  component: AstronautComplexComponent,
  channels: astronautComplexTopics.channels,
  fields: astronautComplexTopics.fields,
  defaultConfig: {},
  actions: astronautComplexActions,
  augmentSlots: [
    "astronaut-complex.crew",
    ASTRONAUT_COMPLEX_CREW_BADGE_SLOT,
    ASTRONAUT_COMPLEX_TRAINING_SLOT,
  ],
  contributionSlots: [ASTRONAUT_COMPLEX_READOUTS_SLOT],
  pushable: true,
});

export { AstronautComplexComponent };
