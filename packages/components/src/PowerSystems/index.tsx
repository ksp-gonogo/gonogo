import { registerComponent } from "@ksp-gonogo/core";
import { type PowerSystemsConfig, powerSystemsActions } from "./config";
import { PowerSystemsConfigForm } from "./PowerSystemsConfigForm";
import { PowerSystemsComponent } from "./PowerSystemsView";
import "./slots";

export type { PowerSystemsScope } from "./slots";

registerComponent<PowerSystemsConfig>({
  id: "power-systems",
  name: "Power Systems",
  description:
    "Producers vs consumers per resource. Aggregates live per-part resource flow across every part on the vessel, solar panels, RTGs, generators, ISRU, drills, engines. Default resource is ElectricCharge; the picker switches to any other resource with live flow contributions. Net rate, total produced, total consumed, plus per-part efficiency where the module exposes a nominal cap.",
  tags: ["telemetry", "ship"],
  defaultSize: { w: 8, h: 12 },
  minSize: { w: 3, h: 3 },
  component: PowerSystemsComponent,
  configComponent: PowerSystemsConfigForm,
  openConfigOnAdd: false,
  // `vessel.resources` is declared as a whole Topic because its reservoir is keyed by resource name.
  dataRequirements: ["vessel.parts", "vessel.resources", "parts.power"],
  defaultConfig: { defaultResource: "ElectricCharge" },
  actions: powerSystemsActions,
  augmentSlots: ["power-systems.sections"],
  pushable: true,
  requires: ["flight"],
});

export { PowerSystemsComponent };
