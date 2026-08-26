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
//   - `./settings/registerPrincipiaSettings` → a declarative row for every
//     field `principia.settings` carries, in one "Principia" category, every
//     one of them stream-backed and therefore read-only. That is what the
//     plugin's configuration IS: a plotting frame and an integration tolerance
//     decide what every other number means, and none of them is something a
//     console may write. The surface is the FLOOR, so no field is held back on
//     the grounds that a widget would suit it better; whether a row ALSO earns
//     a place beside the readout it qualifies is a separate question, and
//     answering it yes takes nothing away from there.
//
// It also declares both Topics and hydrates their units (`./topics`), including
// `principia.settings`, which has no widget of its own and is not meant to.
//
// `PropagationProvenance` was a widget here and is deliberately gone. An operator
// should never meet the word "propagator", and which model produced a number and
// how far ahead it is good for belongs ON that number rather than in a panel of
// its own. The channel, the payload, the decode and the unit hydration all stay:
// the data is still wanted, the panel was not. A setting is also a qualifier on
// some other readout, so it is worth repeating beside the number it qualifies,
// and `principia.settings` exists to put all of them within one subscription of
// wherever that is.
//
// One row was a candidate for the navball and is deliberately not there. The
// in-game guidance toggle says whether the PLUGIN is drawing a stock-shaped node
// on the player's navball; our navball reads the guidance directly, so on our
// navball the row would read as a control over the widget carrying it. It is
// also chosen once and left, which is what the settings surface is for.
//
// The frame-naming table lives in `./plottingFrame`, because that table is what
// stops the next author reaching for the producer's own namer, which aborts the
// process, and it is where the two rules a frame imposes on a readout live: that
// lengths in the pulsating frame are not lengths, and that three of the frames
// have no apsides at all.
import "./topics";
import "./settings/registerPrincipiaSettings";
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
