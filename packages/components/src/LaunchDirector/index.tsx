import { registerComponent } from "@ksp-gonogo/core";
import { launchDirectorActions } from "./actions";
import {
  LaunchDirectorComponent,
  type LaunchDirectorConfig,
} from "./LaunchDirectorView";
import read from "./launch-director.declarations.g";
import { VESSEL_TYPE_LABELS } from "./vesselTypeLabels";

export type { LaunchDirectorActions } from "./actions";
export {
  type CrewMember,
  type CrewReading,
  crewChipTitle,
  crewReading,
  crewTally,
  parseCrew,
} from "./crew";
export { type LaunchSiteEntry, orderPads, parseLaunchSites } from "./pads";
export { parseSavedShips, type SavedShip } from "./ships";
export type {
  LaunchDirectorPadContext,
  LaunchDirectorSlotContext,
} from "./slots";

registerComponent<LaunchDirectorConfig>({
  id: "launch-director",
  name: "Launch & Recovery",
  description:
    "Launch from any pad or runway: pick a craft and crew and launch, or recover or revert what is already there. It also takes you between flight, the Space Center and the Tracking Station, and switches to another vessel. Launches and recoveries always ask you to confirm.",
  tags: ["career", "launch"],
  defaultSize: { w: 7, h: 10 },
  minSize: { w: 4, h: 6 },
  component: LaunchDirectorComponent,
  augmentSlots: ["launch-director.pad", "launch-director.preflight"],
  channels: [],
  fields: [
    "spaceCenter.savedShips.name",
    "spaceCenter.savedShips.file",
    "spaceCenter.savedShips.partCount",
    "spaceCenter.savedShips.totalMass",
    "spaceCenter.savedShips.facility",
    "spaceCenter.savedShips.facilityOrdinal",
    "spaceCenter.savedShips.requiresFunds",
    "spaceCenter.savedShips.missingParts",
    "spaceCenter.crewRoster.name",
    "spaceCenter.crewRoster.trait",
    "spaceCenter.crewRoster.experienceLevel",
    "spaceCenter.crewRoster.available",
    "spaceCenter.crewRoster.unavailableReason",
    "spaceCenter.launchSites.name",
    "spaceCenter.launchSites.displayName",
    "spaceCenter.launchSites.editorFacility",
    "spaceCenter.launchSites.bodyIndex",
    "spaceCenter.launchSites.padOccupied",
    "spaceCenter.launchSites.padVesselTitle",
    "system.bodies",
    "system.vessels",
    "spaceCenter.scene.scene",
    "spaceCenter.scene.launchSite",
    "spaceCenter.state",
    "career.mode",
    "career.status.balances.funds",
    "vessel.identity.name",
    "vessel.identity.launchUt",
    "vessel.flight.altitudeAsl",
    "crash.hasRecent",
    "crash.lastCrash.ut",
    "crash.lastCrash.vesselName",
    "target.available",
  ],
  ...read,
  defaultConfig: {},
  actions: launchDirectorActions,
  pushable: true,
});

// Aliased for `../TargetPicker/enumLabelDrift.test.ts`, since TargetPicker declares its own `VESSEL_TYPE_LABELS`.
export {
  LaunchDirectorComponent,
  VESSEL_TYPE_LABELS as LAUNCH_DIRECTOR_VESSEL_TYPE_LABELS,
};
