import { registerComponent } from "@ksp-gonogo/core";
import { ContractManagerComponent } from "./ContractManagerView";
import type { ContractManagerConfig } from "./config";
import { contractManagerTopics } from "./topics";

export {
  type ContractEntry,
  type ContractParameter,
  type ContractParameterState,
  formatDeadline,
  parseContracts,
} from "./contracts";

registerComponent<ContractManagerConfig>({
  id: "contract-manager",
  name: "Contract Manager",
  description:
    "Career contracts with their terms, deadlines, and rewards. Accept new contracts from the offered list, decline ones you don't want, and cancel active ones (with a confirmation step). Live objective progress and completion alarms are in Objectives.",
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
