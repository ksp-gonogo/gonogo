// GonogoRp1Uplink client for gonogo.
//
// Co-located with the GonogoRp1Uplink C# mod (mod/GonogoRp1Uplink): one
// directory holds the mod and the client TS it ships. Importing this entry
// point side-effects every registration into the host's registries.
import "./uplink";
import "./units";
import "./topics";
import "./settings/rp1SimulationSettings";
import "./AdminBuilding/programsScreen";
import "./CrewSchedule";
import "./CrewSchedule/courses";
import "./CrewSchedule/enrolment";
import "./ContractPayload";
import "./FacilityUpgrades";
import "./KscComplexes";
import "./KscConstruction";
import "./LaunchComplexStatus";
import "./ProgramDetail";
import "./ProgramStatus";
import "./ResearchQueue";
import "./StartResearch";
import "./VehicleAssembly";
import "./WarpTargets";

export {
  ContractPayload,
  RP1_CONTRACT_PAYLOAD_COMMAND,
} from "./ContractPayload";
export { CrewSchedule } from "./CrewSchedule";
export { TrainingCourses } from "./CrewSchedule/courses";
export { TrainingEnrolment } from "./CrewSchedule/enrolment";
export {
  RP1_TRAINING_CANCEL_COMMAND,
  RP1_TRAINING_ENROL_COMMAND,
  RP1_TRAINING_REMOVE_COMMAND,
} from "./CrewSchedule/training";
// This Uplink's own commands: the `CommandArgsMap`/`CommandReplyMap`
// augmentation and the runtime registration. RE-EXPORTED rather than imported
// for side effect, for the same reason ./topics is: a bare import is elided from
// the emitted `dist/index.d.ts` and the augmentation would not cross the package
// boundary.
export { UPLINK_COMMAND_IDS } from "./commands";
export {
  FacilityUpgrades,
  RP1_FACILITY_UPGRADE_COMMAND,
} from "./FacilityUpgrades";
export {
  KscComplexes,
  RP1_COMPLEX_RUSH_COMMAND,
  RP1_PERSONNEL_ASSIGN_COMMAND,
} from "./KscComplexes";
export { KscConstruction } from "./KscConstruction";
export { LaunchComplexStatus } from "./LaunchComplexStatus";
export {
  ProgramDetail,
  RP1_STRATEGY_ACTIVATE_COMMAND,
} from "./ProgramDetail";
export { ProgramStatus } from "./ProgramStatus";
export { ResearchQueue } from "./ResearchQueue";
export {
  RP1_TECH_RESEARCH_COMMAND,
  StartResearch,
} from "./StartResearch";
export { RP1_DELAY_IN_SIMULATION_SETTING } from "./settings/rp1SimulationSettings";
export {
  RP1_AVAILABLE_TOPIC,
  RP1_BUILD_QUEUE_TOPIC,
  RP1_CENTRES_TOPIC,
  RP1_COMPLEXES_TOPIC,
  RP1_CONFIDENCE_TOPIC,
  RP1_CONSTRUCTIONS_TOPIC,
  RP1_CREW_PROGRAM_TOPIC,
  RP1_CREW_TOPIC,
  RP1_OPERATIONS_TOPIC,
  RP1_PADS_TOPIC,
  RP1_PERSONNEL_TOPIC,
  RP1_PROGRAM_FUNDING_CURVES_TOPIC,
  RP1_PROGRAM_SLOTS_TOPIC,
  RP1_PROGRAMS_TOPIC,
  RP1_RESEARCH_TOPIC,
  RP1_RUSH_TERMS_TOPIC,
  RP1_TOOLING_TOPIC,
  RP1_WAREHOUSE_TOPIC,
} from "./topics";

export { RP1 } from "./uplink";
export {
  RP1_BUILD_REPEAT_COMMAND,
  VehicleAssembly,
} from "./VehicleAssembly";
export { BuildCostSection } from "./VehicleAssembly/BuildCost";
export { BuildingSection } from "./VehicleAssembly/Building";
export { VEHICLE_ASSEMBLY_SECTIONS } from "./VehicleAssembly/slot";
export {
  RP1_TOOL_ALL_COMMAND,
  ToolingSection,
} from "./VehicleAssembly/Tooling";
export {
  RP1_ROLLBACK_COMMAND,
  RP1_ROLLOUT_COMMAND,
  RP1_SCRAP_COMMAND,
} from "./VehicleAssembly/VehicleSection";
export { WarehouseSection } from "./VehicleAssembly/Warehouse";
export {
  RP1_WARP_TO_COMPLETE_COMMAND,
  RP1_WARP_TO_FUND_TARGET_COMMAND,
  WarpTargets,
} from "./WarpTargets";
