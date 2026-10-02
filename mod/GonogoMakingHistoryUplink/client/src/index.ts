/**
 * Making History Uplink client: the mission source for the Objectives widget, which lives outside the base library because Making History is a DLC surface.
 * Importing this entry point registers it.
 */

export {
  MissionObjectivesSource,
  missionObjectiveItems,
} from "./ObjectivesSource";

// Bare imports, so bundlers do not tree-shake the registrations away.
import "./uplink";
import "./ObjectivesSource";
