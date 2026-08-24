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
// `principia.settings`, which has no widget of its own and is not meant to.
//
// `PropagationProvenance` was a widget here and is deliberately gone. An operator
// should never meet the word "propagator", and which model produced a number and
// how far ahead it is good for belongs ON that number rather than in a panel of
// its own. The channel, the payload, the decode and the unit hydration all stay:
// the data is still wanted, the panel was not. That is the shape the whole
// settings group takes. A setting there is a qualifier on some other readout, so
// it belongs beside the number it qualifies, and `principia.settings` exists to
// put all of them within one subscription of wherever that is.
//
// The frame-naming table lives in `./plottingFrame`, because that table is what
// stops the next author reaching for the producer's own namer, which aborts the
// process, and it is where the two rules a frame imposes on a readout live: that
// lengths in the pulsating frame are not lengths, and that three of the frames
// have no apsides at all.
import "./topics";
import "./FlightPlanSection";
import "./BurnEditor";
import "./PlanComposer";

export { BurnEditor } from "./BurnEditor";
export { FlightPlanSection } from "./FlightPlanSection";
export { PlanComposer } from "./PlanComposer";
export type { FrameBodies } from "./plottingFrame";
export {
  FRAME_TYPE,
  frameHasApsides,
  frameLengthsPulsate,
  plottingFrameLabel,
} from "./plottingFrame";
