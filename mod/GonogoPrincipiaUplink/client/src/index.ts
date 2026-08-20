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
// It also declares both Topics and hydrates their units (`./topics`), including
// `principia.provenance`, which no longer has a widget.
//
// `PropagationProvenance` was a widget here and is deliberately gone. An operator
// should never meet the word "propagator", and which model produced a number and
// how far ahead it is good for belongs ON that number rather than in a panel of
// its own. The channel, the payload, the decode and the unit hydration all stay:
// the data is still wanted, the panel was not. The frame-naming table it needed
// lives in `./plottingFrame`, because that table is what stops the next author
// reaching for the producer's own namer, which aborts the process.
import "./topics";
import "./FlightPlanSection";

export { FlightPlanSection } from "./FlightPlanSection";
export { plottingFrameLabel } from "./plottingFrame";
