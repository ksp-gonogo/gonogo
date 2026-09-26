import { registerComponent } from "@ksp-gonogo/core";
import { ContractManagerComponent } from "./ContractManagerView";
import type { ContractManagerConfig } from "./config";
import { contractManagerTopics } from "./topics";

export {
  type ContractEntry,
  type ContractParameter,
  type ContractParameterState,
  contractIdToSafeNumber,
  formatDeadline,
  parseContracts,
} from "./contracts";
export type { ContractParameterAlarmTrigger } from "./ParameterAlarm";

registerComponent<ContractManagerConfig>({
  id: "contract-manager",
  name: "Contract Manager",
  description:
    "Career contracts with active objectives, deadlines, and rewards. Accept new contracts from the offered list, decline ones you don't want, and cancel active ones (with a confirmation step). A bell next to each open objective sets an alarm that fires when the objective completes.",
  tags: ["career", "contracts"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 4, h: 5 },
  component: ContractManagerComponent,
  channels: contractManagerTopics.channels,
  fields: contractManagerTopics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["career"],
});

export { ContractManagerComponent };
