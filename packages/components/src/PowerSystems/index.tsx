import { registerComponent } from "@ksp-gonogo/core";
import { type PowerSystemsConfig, powerSystemsActions } from "./config";
import { PowerSystemsConfigForm } from "./PowerSystemsConfigForm";
import { PowerSystemsComponent } from "./PowerSystemsView";
import "./slots";
import read from "./power-systems.declarations.g";
import { usePowerSystemsEssentials } from "./usePowerSystemsEssentials";

export type { PowerSystemsScope } from "./slots";

registerComponent<PowerSystemsConfig>({
  id: "power-systems",
  name: "Power Systems",
  description:
    "What makes and uses electric charge (EC) on your vessel, part by part: solar panels, RTGs, generators, drills, engines and more. Shows the net rate and the totals, and can switch to any other resource that is flowing.",
  tags: ["telemetry", "ship"],
  defaultSize: { w: 8, h: 12 },
  // Below four columns the net rate is the tiny form's, with the title behind a hover.
  minSize: { w: 4, h: 3 },
  component: PowerSystemsComponent,
  tiny: {
    title: "POWER",
    bindsActions: true,
    useEssentials: usePowerSystemsEssentials,
  },
  configComponent: PowerSystemsConfigForm,
  openConfigOnAdd: false,
  channels: ["vessel.parts"],
  ...read,
  defaultConfig: { defaultResource: "ElectricCharge" },
  actions: powerSystemsActions,
  augmentSlots: ["power-systems.sections"],
  pushable: true,
  requires: ["flight"],
});

export { PowerSystemsComponent };
