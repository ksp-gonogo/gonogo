import { registerComponent } from "@ksp-gonogo/core";
import { launchDirectorActions } from "./actions";
import {
  LaunchDirectorComponent,
  type LaunchDirectorConfig,
} from "./LaunchDirectorView";
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
    "Every launch pad across the space centre, the ones with something standing on them first, and what you can do from the one you open: launch a craft and crew from it, or recover and revert what is already there. Greyed-out craft are blocked by funds or missing tech; a kerbal who cannot fly is greyed out and says why, or reads as no reading where the roster carried no availability. Buttons that fire a launch or recovery always confirm before sending the action.",
  tags: ["career", "launch"],
  defaultSize: { w: 7, h: 10 },
  minSize: { w: 4, h: 6 },
  component: LaunchDirectorComponent,
  augmentSlots: ["launch-director.pad", "launch-director.preflight"],
  dataRequirements: [
    "spaceCenter.savedShips",
    "spaceCenter.crewRoster",
    "spaceCenter.launchSites",
    "spaceCenter.scene.scene",
    "spaceCenter.scene.launchSite",
    "career.status.economy.funds",
    "career.status.economy.subsidyPerDay",
    "career.status.economy.upkeepPerDay",
    "vessel.identity.name",
    "vessel.identity.launchUt",
    "vessel.flight.altitudeAsl",
    "crash.hasRecent",
    "crash.lastCrash",
    "target.available",
  ],
  defaultConfig: {},
  actions: launchDirectorActions,
  pushable: true,
});

// Aliased for `../TargetPicker/enumLabelDrift.test.ts`, since TargetPicker declares its own `VESSEL_TYPE_LABELS`.
export {
  LaunchDirectorComponent,
  VESSEL_TYPE_LABELS as LAUNCH_DIRECTOR_VESSEL_TYPE_LABELS,
};
