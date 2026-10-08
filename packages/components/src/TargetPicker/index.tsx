import { registerComponent } from "@ksp-gonogo/core";
import { type TargetPickerConfig, targetPickerActions } from "./config";
import { SITUATION_LABELS, VESSEL_TYPE_LABELS } from "./entries";
import { TargetPickerConfigForm } from "./TargetPickerConfigForm";
import { TargetPickerComponent } from "./TargetPickerView";
import { targetPickerTopics } from "./topics";

export { SPACE_OBJECT_VESSEL_TYPE } from "./entries";

registerComponent<TargetPickerConfig>({
  id: "target-picker",
  name: "Target Picker",
  description:
    "Pick a target from a suggested list or browse bodies, vessels and parts, or see your current target's type, distance and closing speed and clear it.",
  tags: ["telemetry", "navigation"],
  defaultSize: { w: 6, h: 11 },
  minSize: { w: 3, h: 3 },
  commands: ["vessel.target.set", "vessel.target.clear"],
  component: TargetPickerComponent,
  configComponent: TargetPickerConfigForm,
  augmentSlots: ["target-picker.sections"],
  channels: targetPickerTopics.channels,
  optionalChannels: targetPickerTopics.optionalChannels,
  defaultConfig: {},
  actions: targetPickerActions,
  pushable: true,
  requires: ["flight"],
});

// Aliased for `enumLabelDrift.test.ts`, since LaunchDirector declares its own `VESSEL_TYPE_LABELS`.
export {
  SITUATION_LABELS as TARGET_PICKER_SITUATION_LABELS,
  TargetPickerComponent,
  VESSEL_TYPE_LABELS as TARGET_PICKER_VESSEL_TYPE_LABELS,
};
