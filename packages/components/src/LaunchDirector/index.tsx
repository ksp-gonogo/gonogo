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
  description: "Launch, recover and revert vessels, and switch between them.",
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
    "spaceCenter.launchSites.latitude",
    "spaceCenter.launchSites.longitude",
    "spaceCenter.launchSites.isStock",
    "spaceCenter.launchSites.padOccupied",
    "spaceCenter.launchSites.padVesselTitle",
    "trackingStation.bodies",
    "trackingStation.catalog",
    "spaceCenter.scene.scene",
    "spaceCenter.scene.launchSite",
    "spaceCenter.state",
    "career.mode",
    "career.status.balances.funds",
    "vessel.identity.name",
    "vessel.identity.vesselId",
    "vessel.identity.launchUt",
    "eva.crew.kerbals",
    "vessel.flight.altitudeAsl",
    "crash.hasRecent",
    "crash.lastCrash.ut",
    "crash.lastCrash.vesselId",
    "crash.lastCrash.vesselName",
    "recovery.lastSummary.vesselName",
    "recovery.lastSummary.recoveryLocation",
    "recovery.lastSummary.capturedAtUT",
    "recovery.lastSummary.fundsEarned",
    "recovery.lastSummary.scienceEarned",
    "recovery.lastSummary.crewBreakdown",
    "recovery.lastSummary.partBreakdown",
    "recovery.lastSummary.scienceBreakdown",
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
