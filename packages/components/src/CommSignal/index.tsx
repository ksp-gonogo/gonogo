import { registerComponent } from "@ksp-gonogo/core";
import { CommSignalComponent } from "./CommSignalView";
import read from "./comm-signal.declarations.g";
import type { CommSignalConfig } from "./config";
import { commSignalTopics } from "./topics";
import { useCommSignalEssentials } from "./useSignalVerdict";
import "./badge";

registerComponent<CommSignalConfig>({
  id: "comm-signal",
  name: "CommNet Signal",
  description:
    "Your vessel's CommNet (KSP's communication network) connection: signal strength, how much control you have over a probe, and the signal delay. At larger sizes it shows each relay on the route home.",
  tags: ["telemetry", "comms"],
  defaultSize: { w: 6, h: 6 },
  // Below four rows the caption and the detail grid are dropped, leaving the bars and the figure.
  minSize: { w: 3, h: 4 },
  component: CommSignalComponent,
  tiny: {
    title: "COMMNET",
    useEssentials: useCommSignalEssentials,
  },
  augmentSlots: ["comm-signal.sections"],
  // A contribution only computes for a slot its widget declares.
  contributionSlots: ["comm-signal.hop-rates"],
  // Connectivity is the freeze-exempt `comms.link`; `vessel.comms` holds its last value through a blackout.
  channels: commSignalTopics.channels,
  ...read,
  fields: commSignalTopics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CommSignalComponent };
