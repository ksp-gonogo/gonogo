import type { ExtensionScene } from "../coverage";
import { SCENES as actionGroup } from "./action-group";
import { SCENES as astronautComplex } from "./astronaut-complex";
import { SCENES as commSignal } from "./comm-signal";
import { SCENES as crewStatus } from "./crew-status";
import { SCENES as deployedScience } from "./deployed-science";
import { SCENES as experiments } from "./experiments";
import { SCENES as fuelStatus } from "./fuel-status";
import { SCENES as landingStatus } from "./landing-status";
import { SCENES as launchDirector } from "./launch-director";
import { SCENES as maneuverPlanner } from "./maneuver-planner";
import { SCENES as mapView } from "./map-view";
import { SCENES as orbitView } from "./orbit-view";
import { SCENES as powerSystems } from "./power-systems";
import { SCENES as scienceData } from "./science-data";
import { SCENES as shipMap } from "./ship-map";
import { SCENES as spaceCenterStatus } from "./space-center-status";
import { SCENES as strategies } from "./strategies";
import { SCENES as systemView } from "./system-view";
import { SCENES as targetPicker } from "./target-picker";
import { SCENES as targeting } from "./targeting";
import { SCENES as techTree } from "./tech-tree";
import { SCENES as warpControl } from "./warp-control";

/** Each planted slot stub, on a scene of its host widget that draws the slot. */
export const SLOT_SCENES: readonly ExtensionScene[] = [
  ...actionGroup,
  ...astronautComplex,
  ...commSignal,
  ...crewStatus,
  ...deployedScience,
  ...experiments,
  ...fuelStatus,
  ...landingStatus,
  ...launchDirector,
  ...maneuverPlanner,
  ...mapView,
  ...orbitView,
  ...powerSystems,
  ...scienceData,
  ...shipMap,
  ...spaceCenterStatus,
  ...strategies,
  ...systemView,
  ...targetPicker,
  ...targeting,
  ...techTree,
  ...warpControl,
];
