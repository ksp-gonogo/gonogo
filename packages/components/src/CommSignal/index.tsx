import { registerComponent } from "@ksp-gonogo/core";
import { CommSignalComponent } from "./CommSignalView";
import type { CommSignalConfig } from "./config";
import { commSignalTopics } from "./topics";
import "./badge";
import "./slots";

registerComponent<CommSignalConfig>({
  id: "comm-signal",
  name: "CommNet Signal",
  description:
    "Signal bars, percentage, probe control state (full / partial / none), and signal delay from KSP's CommNet.",
  tags: ["telemetry", "comms"],
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 3, h: 3 },
  component: CommSignalComponent,
  augmentSlots: ["comm-signal.sections"],
  // A contribution only computes for a slot its widget declares.
  contributionSlots: ["comm-signal.hop-rates"],
  // Connectivity is the freeze-exempt `comms.link`; `vessel.comms` holds its last value through a blackout.
  channels: commSignalTopics.channels,
  fields: commSignalTopics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CommSignalComponent };
