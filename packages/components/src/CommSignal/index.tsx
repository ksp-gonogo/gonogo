import { registerComponent } from "@ksp-gonogo/core";
import { CommSignalComponent } from "./CommSignalView";
import type { CommSignalConfig } from "./config";
import { commSignalTopics } from "./topics";
import { useCommSignalEssentials } from "./useSignalVerdict";
import "./badge";

registerComponent<CommSignalConfig>({
  id: "comm-signal",
  name: "CommNet Signal",
  description:
    "Your vessel's CommNet connection: signal strength, how much control you have over a probe, and the signal delay. At larger sizes it shows each relay on the route home.",
  tags: ["telemetry", "comms"],
  defaultSize: { w: 6, h: 5 },
  // The body fits from three rows up; below it the bars crowd the figure.
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
  optionalChannels: commSignalTopics.optionalChannels,
  fields: commSignalTopics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CommSignalComponent };
