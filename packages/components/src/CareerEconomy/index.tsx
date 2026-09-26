import { defineTopicManifest, registerComponent } from "@ksp-gonogo/core";
import {
  CareerEconomyComponent,
  type CareerEconomyConfig,
} from "./CareerEconomyView";

const topics = defineTopicManifest({
  channels: ["career.status"],
  fields: [
    "career.status.economy.funds",
    "career.status.economy.reputation",
    "career.status.economy.economyModel",
    "career.status.economy.reputationDecayPerDay",
    "career.status.economy.subsidyPerDay",
    "career.status.economy.subsidyMinPerDay",
    "career.status.economy.subsidyMaxPerDay",
    "career.status.economy.upkeepPerDay",
    "career.status.economy.upkeep",
    "career.status.economy.upkeepBeforeModifiers",
  ],
});

registerComponent<CareerEconomyConfig>({
  id: "career-economy",
  name: "Programme Funding",
  description:
    "What a career's money is doing rather than how much of it there is: the funds and reputation balances, the reputation's daily decay, the funding subsidy it currently earns against the range it could, the standing per-day cost and where that cost goes, and the net of the two. Stock career says money does none of this, and says so in a sentence.",
  tags: ["career"],
  defaultSize: { w: 4, h: 7 },
  minSize: { w: 2, h: 3 },
  component: CareerEconomyComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
});

export { CareerEconomyComponent };
