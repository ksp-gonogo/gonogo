// Breaking Ground Uplink client for gonogo.
//
// Co-located (by name, not by C# assembly) with the bundled, DLC-gated
// Gonogo.KSP.BreakingGroundUplink ([SitrepUplink("breakingGround")], shipped
// IN the core mod DLL alongside PartsUplink/VesselUplink, see
// mod/Gonogo.KSP/BreakingGroundUplink.cs): this package holds the CLIENT
// half, the three widgets that used to live in @ksp-gonogo/components before
// robotics + deployed science were split out of the vanilla-comingled
// PartsUplink/ScienceUplink. Importing this package's entry point
// side-effects the widget registration into @ksp-gonogo/core's global
// component registry:
//
//   - `uplink.ts` -> defineUplinkClient({ id: "breakingGround", ... })
//     declares this client's identity; every registration below stamps the
//     returned BREAKING_GROUND
//     handle as `owner`, so the widget picker's mod search tags derive
//     "breakingGround" automatically.
//   - `RoboticsConsole` -> registerComponent({ id: "robotics-console", ... })
//   - `RotorTachometer` -> registerComponent({ id: "rotor-tachometer", ... })
//   - `DeployedScience` -> registerComponent({ id: "deployed-science", ... })
//
// To wire it into the app: `import "@ksp-gonogo/gonogo-breaking-ground-uplink";`
// during app bootstrap (alongside the other component-registration imports
// in app/src/main.tsx).

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

// Side-effect registration. Kept as bare imports so the built dist/index.js
// retains them and bundlers won't tree-shake the registerComponent() calls away.
import "./uplink"; // defineUplinkClient(BREAKING_GROUND): every widget below stamps `owner: BREAKING_GROUND`
import "./RoboticsConsole";
import "./RotorTachometer";
import "./DeployedScience";
