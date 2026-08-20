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
//   - `PropagationProvenance` → registerComponent, a widget of its own because
//     it answers "can I trust any of this" for the whole dashboard rather than
//     for one host widget, so there is no host it belongs inside.
//
// It also declares both Topics and hydrates their units (`./topics`).
import "./topics";
import "./FlightPlanSection";
import "./PropagationProvenance";

export { FlightPlanSection } from "./FlightPlanSection";
export { PropagationProvenanceComponent } from "./PropagationProvenance";
