// GonogoPrincipiaUplink client for gonogo.
//
// Co-located with the GonogoPrincipiaUplink C# mod (mod/GonogoPrincipiaUplink):
// one directory holds the mod and the client TS it ships. Importing this entry
// point side-effects the registration:
//
//   - `FlightPlanSection` → registerAugment into `maneuver-planner.sections`,
//     so the n-body flight plan appears below the built-in maneuver preview.
//     An augment rather than a new widget because the plan belongs beside the
//     planner an operator is already reading, and that slot exists for exactly
//     this case.
//
// It also declares `principia.flightPlan` and hydrates its units (`./topics`).
import "./topics";
import "./FlightPlanSection";

export { FlightPlanSection } from "./FlightPlanSection";
