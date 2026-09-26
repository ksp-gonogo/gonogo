/**
 * Breaking Ground Uplink client: the robotics and deployed-science widgets, which live outside the base library because they are DLC surfaces.
 * Importing this entry point registers all three widgets.
 */

export type {
  DeployedBase,
  DeployedExperiment,
  DeployedExperimentContext,
} from "./DeployedScience";
export { DeployedScienceComponent, parseBases } from "./DeployedScience";
export type {
  RoboticsConsoleActions,
  ServoInfo,
  ServoType,
} from "./RoboticsConsole";
export { parseServos, RoboticsConsoleComponent } from "./RoboticsConsole";
export type { RotorInfo, RotorTachometerActions } from "./RotorTachometer";
export { parseRotors, RotorTachometerComponent } from "./RotorTachometer";

// Bare imports, so bundlers do not tree-shake the registrations away.
import "./uplink";
import "./RoboticsConsole";
import "./RotorTachometer";
import "./DeployedScience";
