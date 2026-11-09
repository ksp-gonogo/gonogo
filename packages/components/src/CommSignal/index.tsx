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
  description: "Your vessel's CommNet signal, control and delay.",
  tags: ["telemetry", "comms"],
  defaultSize: { w: 6, h: 6 },
  // A tile this small shows the bars and the figure; the caption and the detail grid need four columns.
  minSize: { w: 3, h: 4 },
  component: CommSignalComponent,
  tiny: {
    title: "COMMNET",
    useEssentials: useCommSignalEssentials,
  },
  augmentSlots: ["comm-signal.sections"],
  // A contribution only computes for a slot its widget declares.
  contributionSlots: ["comm-signal.hop-rates", "comm-signal.link-rate"],
  // Connectivity is the freeze-exempt `comms.link`; `vessel.comms` holds its last value through a blackout.
  channels: commSignalTopics.channels,
  ...read,
  fields: commSignalTopics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  awaitsFirstSignal: { heading: "COMMNET" },
  requires: ["flight"],
});

export { CommSignalComponent };
