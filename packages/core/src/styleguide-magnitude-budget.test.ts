import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `.magnitude` is an escape hatch, and this is what makes reaching for it cost
 * something.
 *
 * The unit algebra can add, subtract, scale and compare `Value`s, and it knows
 * which quantities are instants and which are intervals. None of that helps if
 * the habit is to unwrap first and compute on bare numbers. An escape hatch
 * that is free to reach for is just the default path.
 *
 * Plenty of these unwraps are correct and always will be. A d3 scale wants a
 * number, `<progress value>` wants a number, `Math.max` wants a number. Those
 * stay on the list permanently, and that is the point: the list is not a
 * backlog, it is a budget. What it stops is the next piece of ARITHMETIC being
 * added silently.
 *
 * ## Adding to the list
 *
 * If a call site genuinely needs the raw number, raise its file's count and say
 * why in the same commit. Someone reads that reason. If you cannot write one,
 * the computation probably belongs in the algebra:
 *
 *     a.magnitude - b.magnitude    ->  a.minus(b)
 *     utA - utB.magnitude          ->  value("ut", utA).minus(utB)
 *     rate.magnitude * 3600        ->  rate.in("rad/h")
 *
 * Counts are per FILE rather than per line, because line numbers churn on every
 * edit above them and a ratchet that fails for unrelated reasons gets disabled.
 *
 * ## Two acts, two counts
 *
 * Two things look identical in source: DISCARDING dimension in order to
 * compute on bare numbers, which is the defect this budget exists for, and
 * SERIALISING at a numeric boundary, which is unavoidable.
 *
 * `Value.toWire()` is the second act, named. It is counted HERE, by
 * {@link WIRE_BUDGET}, on the same shrink-only terms: a separate ceiling, not
 * an exemption. An uncounted exit would just be `.magnitude` with a better
 * name.
 *
 * `magnitudeOf` and `magnitudeOr` are the same case from the other side: an
 * honest funnel whose one `.magnitude` is spent on behalf of every caller, so
 * the property scan cannot see any of them. {@link FUNNEL_BUDGET} counts their
 * CALLS instead, again as a separate ceiling rather than an exemption.
 *
 * A name is not a guard, so there is also
 * {@link WIRE_ARITHMETIC_PATTERNS}, which has no debt list at all and fails on
 * a wire number appearing as an operand of `+ - * / %`.
 */

/**
 * Per-file `.magnitude` budget. Each entry EQUALS what its file uses: a file
 * absent from this map may not use any, a file over its number fails, and so
 * does a file under it, because an entry above the live count is permission for
 * that many new unwraps rather than a record of anything. See "has no entry
 * above what its file actually uses" below for why that arm throws rather than
 * warning.
 */
const MAGNITUDE_BUDGET: Record<string, number> = {
  // ONE, in a named `kilograms()` helper at the command boundary and nowhere else.
  // `rp1.contracts.setPayload` declares its two fields as `int?` in kilograms,
  // because RP-1 stores them as `int` and validates against an integer range and
  // an integer step, so a raw number has to exist where the typed value meets the
  // wire. The figures a READER sees go out through `<Unit>`.
  /*
   * The one place a wire Value meets transcribed arithmetic. A new complex is
   * priced against what the operator is typing, so its pad and integration halves
   * are a closed form over plain numbers, transcribed from RP-1 and pinned against
   * figures the shipped assembly generated. The resource half arrives as a
   * funds-per-unit Value and has to join those as a number to be summed with them.
   * Every figure a READER sees goes back out through `<Unit>`.
   */
  /*
   * ONE, where the delay reading leaves the contract for the design system.
   * `signalDelayPresentation` decides which of the two delay readings a console
   * draws, and it lives in `ui-kit`, which is props-driven and carries no
   * contract types: `InFlightList` beside it takes plain seconds for the same
   * reason. So the terminal unwraps once, here, and the figure a READER sees
   * goes back out through `<Unit>` inside the badge.
   */
  "mod/GonogoKosUplink/client/src/KosTerminal/index.tsx": 1,
  "mod/GonogoKerbalismUplink/client/src/processor.ts": 1,
  "mod/GonogoKerbalismUplink/client/src/SpaceWeather/index.tsx": 1,
  // 1: the contribution entry carries a BARE bits/sec so CommSignal can compare
  // legs to find the bottleneck. A comparison across a slot boundary cannot
  // carry a Value, because the entry crosses the published contract as JSON.
  // 5: `pathConnectedDuring(a.magnitude, b.magnitude)`
  // spends two on one. That pair is a boundary rather than arithmetic:
  // `PathConnectedDuring` is a CALLER-supplied predicate over bare UT numbers,
  // so the instants shed their type where they leave for someone else's code.
  "mod/sitrep-sdk/src/command-delay.ts": 5,
  // 1, in `degradeRatingOf`, and this file exists so that number stays 1. The
  // link grading has to reach a consumer as a raw number, because what a
  // consumer DOES with it is arithmetic on a quality ladder (a bitrate rung, how
  // much noise to mix) rather than anything in a dimension, and no `Unit` ever
  // renders it. What is unwrapped here is also the thing being CHECKED: the
  // 0..1 promise is re-kept on arrival, and doing it once here is the point: the
  // alternative is every consumer clamping at its own call site, which is the
  // shape `1 - comms.signal.strength` already took.
  //
  // ONE, and only because `DegradeRating.level` is a plain number on the way
  // out. The non-finite check is `Value.isFinite()` and the clamp is
  // `.max(0).min(1)`, both in the algebra.
  "mod/sitrep-sdk/src/comms-degrade.ts": 1,
  // 6: the floors that turn an instant into calendar PARTS, plus the round
  // that lands the inverse back on a whole second. A day number is not a
  // quantity with a unit, it is an ordinal, so producing one is where the
  // algebra stops. Every RATIO still comes from the unit system: this file
  // owns none, which is what stops it being a second clock beside the one the
  // app renders through.
  "mod/sitrep-sdk/src/burn-clock.ts": 6,
  // 1: the view instant, read out to stamp when a composed plan was decided.
  // The wire carries it as a plain UT because the receiving side records it on
  // a receipt rather than doing algebra with it.
  "mod/sitrep-sdk/src/api/index.ts": 1,
  // 3, all three in `frameVector`. The frame arithmetic
  // works in bare metres throughout (a rotation matrix has no unit to carry),
  // so SOMETHING has to unwrap a wire vector before `toFrame` sees it. The
  // alternative is every Uplink author doing it at their own call sites. The
  // unwrap is constrained to `"m"` and `"m/s"` here, which is the check a
  // hand-rolled one does not get.
  "mod/sitrep-sdk/src/frames/index.ts": 3,
  // 2: the observed instant a plan was built from, and the comparison against
  // the view instant that catches a plan built from a state nobody could have
  // seen. Both are read out here because this file IS that boundary.
  // The uplink window is arithmetic on INSTANTS against a delay in seconds, and
  // the shared `commandWindow` it feeds takes plain numbers because the burn
  // editor computes the same window from the same numbers. Two of these are the
  // instants going in and one is the view clock; doing it in the algebra would
  // mean a second implementation of a deadline both surfaces have to agree on.
  // The one place a magnitude is unavoidable on the INPUT side: a DOM field
  // holds a string, so somewhere the value has to become a number and back.
  // Having it here once is what lets every widget stop doing it: `UnitInput`
  // emits a `Value`, so a call site never sees a bare number at all.
  "packages/ui-kit/src/UnitInput.tsx": 1,
  // This file is where the escape hatch belongs: its
  // job IS the wire shape, and the receiving side binds every instant and every
  // Δv component to a plain double. A `Value` reaching it is refused from inside
  // the handler, which loses the whole plan and marks the vessel uplink
  // unavailable for the session. Unwrapping once here is what stops every caller
  // building that shape by hand and finding out the same way.
  "mod/sitrep-sdk/src/plan-composition.ts": 8,
  // 2: `lerpFieldValue(key,
  // before.magnitude, after.magnitude, t)` spends two on one line. Both are a
  // boundary: the recursion re-enters itself on the plain-number branch and re-declares the
  // unit on the way out, so the two samples meet the interpolator bare and by
  // construction share a unit.
  "mod/sitrep-sdk/src/spine/timeline-store.ts": 2,
  "mod/sitrep-sdk/src/testing/render.tsx": 1,
  /*
   * 1: the one-way delay, read out of the `comms.delay` wire payload so the
   * warp-to controller can floor its safety margin at the light-time. The
   * boundary is on the other side: what the controller does with it is
   * `remainingGameSeconds / margin`, over a remaining-time number the alarm
   * state machine produces bare and a margin the operator types into a plain
   * `<input>`. Neither is a `Value`, so there is no algebra for the delay to
   * stay inside.
   */
  "packages/app/src/alarms/AlarmHostService.ts": 1,
  "packages/app/src/alarms/WarpObserver.ts": 1,
  /*
   * 1 each, and both are the wire boundary. A Commcast message crosses PeerJS
   * as JSON, so the separation it freezes has to be a plain `number | null`:
   * a `Value<"s">` serialises to an object the receiving side would then have
   * to unwrap by hand at every read, which is the same unwrap done N times
   * instead of once. The context's is the mirror of it, turning the published
   * pair matrix into the lookup the reveal rule indexes.
   */
  "packages/app/src/commcast/CommcastComponent.tsx": 1,
  "packages/app/src/commcast/CommcastContext.tsx": 1,
  "packages/app/src/telemetry/KspCalendarObserver.tsx": 4,
  /*
   * 2, and they are the subject rather than a use. This file is the planted
   * violation for the primitive-reading-feed gate: both unwraps exist so that
   * gate can be seen to catch a magnitude taken off a payload and a magnitude
   * taken two calls deep. Fixing them would blind the gate that finds them
   * everywhere else, which is the one case where the algebra is not the
   * answer. It is in no tsconfig and ships nowhere.
   */
  "packages/components/fixtures/primitive-reading-feed-plant.tsx": 2,
  "packages/components/src/CommSignal/index.tsx": 1,
  "packages/components/src/ContractManager/index.tsx": 2,
  "packages/components/src/CrewStatus/badge.ts": 2,
  /*
   * 2. The second is `suitResourceTone`, which bands a
   * suit tank's remaining fraction against two thresholds. The division is
   * `amount.dividedBy(capacity)` and therefore dimension-checked; its quotient
   * is dimensionless by construction, so the unwrap is on a number that has
   * already stopped being a quantity, and it is never shown. The figures a
   * READER sees are the two halves of the pair, written by `<Meter>`.
   */
  "packages/components/src/CrewStatus/index.tsx": 2,
  "packages/components/src/CurrentOrbit/index.tsx": 3,
  "packages/components/src/FleetRoster/index.tsx": 3,
  "packages/components/src/FuelStatus/index.tsx": 1,
  // 19: every plot on this widget is a contribution, and each
  // reads its own Topics. The nineteenth is the altitude RAIL's own AGL: the
  // rail is a gauge rather than a plot, so it stayed the widget's and reads its
  // one number here.
  //
  // The three entries below are where the plot reads live. That is the cost of
  // the model rather than a regression to work off: a plot that derives its own
  // inputs cannot share the
  // host's derivation, because a host with a derivation to share is a host with
  // a privilege an outside author does not have. Three plots reading the same
  // four Topics unwrap them three times, on purpose.
  "packages/components/src/LandingStatus/index.tsx": 19,
  // 7: the descent envelope's own layers, in the plot's own axes. The two
  // terminal anchors, the height and the speed set the frame and feed the
  // integration; the drag ratio scales a mark and the Mach number decides
  // whether the projection is drawn as an estimate. All arithmetic, none of it
  // a term the algebra has, and every number a READER sees still goes out
  // through `writeQuantity`.
  "packages/components/src/LandingStatus/descentLayers.ts": 7,
  // 11: the cross-section. The terrain patch is a list of elevations that
  // becomes a polyline in the plot's own space, and the drift, the height and
  // the two speed components set its frame and its vector. Every number a
  // READER sees still leaves through `writeQuantity`.
  "packages/components/src/LandingStatus/crossSectionPlot.ts": 11,
  // 20: the reticle, and the highest of the three because it derives the most.
  // Four coordinates for the great-circle drift, the patch and its footprint
  // for the relief, and the dispersion zone, which is not on the wire at all:
  // it is a horizontal-travel estimate that needs the speed, the time to impact
  // and, in vacuum, a surface gravity backed out of mu and the radius.
  "packages/components/src/LandingStatus/touchdownReticlePlot.ts": 20,
  // 1: the view instant, unwrapped to bucket it and to hand it to the frame
  // arithmetic. Every function that solves a body's position takes a bare UT,
  // because a Kepler solve is trigonometry on a number and not an operation the
  // algebra has a term for.
  "packages/components/src/LibrationPoints/index.tsx": 1,
  "packages/components/src/ManeuverPlanner/index.tsx": 5,
  "packages/components/src/ManeuverPlanner/LocalManeuverTriggerService.ts": 10,
  // 18: two `{ ut, lat, lon }` literals each unwrap a latitude
  // and a longitude side by side. One of them is a maneuver node's own
  // UT. It reads the modern vessel.maneuver shape, where the instant is a
  // Value; the horizon it feeds is plain-number geometry against a plain-number
  // view instant, so the unwrap belongs at that boundary rather than one term
  // deeper.
  "packages/components/src/MapView/index.tsx": 18,
  "packages/components/src/MapView/vanillaPoiProvider.ts": 2,
  // 1: minting a Value from a contributed row's magnitude-and-unit pair so the
  // host can render it through Unit. The slot cannot carry a Value (its two
  // declarations must be structurally identical to merge, and a Value reached
  // by two module paths is not), so the raw number arrives by contract and the
  // unwrap is the reconstruction rather than an escape.
  "packages/components/src/Navball/index.tsx": 1,
  "packages/components/src/OrbitView/index.tsx": 6,
  /*
   * ONE, on a quotient `dividedBy` has already made dimensionless: a part
   * meter's fill, which becomes an SVG length and a spoken percentage. The
   * division is the dimension check, and the single unwrap is where the
   * fraction stops being a quantity.
   */
  "packages/components/src/ShipMap/ShipDiagramSvg.tsx": 1,
  "packages/components/src/SemiMajorAxis/index.tsx": 1,
  // 1: the view instant, unwrapped to bound a history window. sampleRange
  // takes plain UT numbers because a store index is not a quantity.
  "packages/components/src/shared/usePastTrack.ts": 1,
  /*
   * 3, all three in `bare`: the three components come off one line. `bare` is
   * the honest form of an `as Vec3` cast, which would assert the leaves were
   * numbers and put a `Value` into `toFixed` the moment they were not.
   */
  "packages/components/src/shared/dockAngles.ts": 3,
  "packages/components/src/shared/OrbitalEventChips.tsx": 1,
  "packages/components/src/Strategies/index.tsx": 1,
  "packages/components/src/SystemView/index.tsx": 15,
  // 5: the LAN and argPe coalesce, each `?.magnitude ?? 0` or `?.magnitude`
  // behind a `Number.isFinite` guard, is expressed through `magnitudeOr` and
  // `magnitudeOf` instead and so does not count here. What is left is the five
  // elements the shared Kepler solver takes as canonical SI numbers.
  "packages/components/src/SystemView/usePhaseAngles.ts": 5,
  /*
   * THREE, and each is a boundary rather than arithmetic: the view UT the
   * widget subtracts from, a stream field that arrives as a bare number, and a
   * dot product handed to a reticle that draws in bare numbers.
   *
   * The age the widget shows is no longer among them. It is carried as the
   * quantity it is, from the subtraction all the way to the `<Unit>` that
   * writes it, and clamped by the algebra's own `max(0)` rather than by
   * `Math.max` on an unwrapped magnitude.
   */
  "packages/components/src/Targeting/index.tsx": 3,
  "packages/components/src/ThermalStatus/index.tsx": 13,
  // 1: the Δv budget the reach list compares against.
  // `calc/transfer.ts` and the porkchop are deliberately plain-SI ("no React,
  // no side effects", see their own docs), so a `Value<"m/s">` off the wire has
  // to shed its unit exactly once to be compared against a solver's cost. Doing
  // it in the algebra instead would mean wrapping every figure the coplanar
  // model returns.
  "packages/components/src/TransferWindow/index.tsx": 1,
  // 6: the six components of one body state, crossing from the contract's
  // `BodyState` (position and velocity as `Value<"m">` / `Value<"m/s">`, which
  // is what the wire declares) into `StateLike` in `calc/porkchop.ts`, whose
  // `Vec3Tuple` is plain SI for the same stated reason the entry above gives.
  // Nothing is computed here, so there is no algebra to do it in: it is a
  // shape change at the boundary between a typed payload and a solver that
  // predates it, once per requested instant.
  "packages/components/src/TransferWindow/useBodyStatePropagators.ts": 6,
  // The shared ΔV budget's one raw read: `totalVac` is `Value<"m/s"> | null` and
  // the feasibility deduction below it subtracts plain node magnitudes in a
  // running total. Doing it in the algebra would wrap and unwrap once per node
  // for a number that never leaves this function.
  "packages/data/src/hooks/useManeuverFeasibility.ts": 1,
  // ONE: the view instant, on its way into the Kepler solve. `useViewUt` hands
  // a `Value<"ut">` and `solveOrbit` takes the plain seconds its own internals
  // work in (radians, mean motion, a propagated position vector), so this hook
  // is where the typed instant meets a plain-number API. Nothing it returns is
  // a string, and every figure a reader sees goes out through `<Unit>`.
  "packages/core/src/hooks/useOrbitSolve.ts": 1,
  // 4: the burn instant and the plan's own total, unwrapped here because this
  // hook IS the boundary between the wire shape and the plain-number geometry
  // every node consumer works in. The three delta-v components go through
  // ui-kit's `magnitudeOr` instead, which is what a component absent from the
  // wire wants: nothing added to the vector, said in one place.
  "packages/data/src/hooks/useManeuverNodes.ts": 4,
  "packages/data/src/hooks/useDataSeries.ts": 1,
  // 22: the part's `up` vector spends three on one
  // line. It is
  // the wire-to-plain-model adapter for the parts list, so every read here is
  // the same boundary said once per field.
  "packages/data/src/hooks/vesselPartsAdapter.ts": 22,
  "packages/data/src/replaySession/ReplaySessionBanner.tsx": 1,
  // `numOrNull`, the one funnel where a body's wire quantities become the plain
  // numbers the system diagram scales into SVG coordinates. One place,
  // deliberately, and it is why re-pointing that file at the unit system was a
  // two-line change.
  "mod/sitrep-sdk/src/spine/celestial-facts.ts": 1,
  /*
   * Two: reading a stage field's magnitude out of a wire row typed `unknown`
   * (there is no Value to do algebra with until it has been recognised as
   * one), and the budget's age against the frame's view UT, which arrives as
   * a plain number on `ProcessorFrame` rather than as an instant.
   */
  "mod/sitrep-sdk/src/spine/delta-v-budget.ts": 2,
  "mod/sitrep-sdk/src/spine/delay-authority.ts": 1,
  "packages/sitrep-client/src/fleet-position.ts": 1,
  // The one decode of a `fleet.` payload's quantities. Whether a quantity
  // arrives wrapped depends on the TOPIC, not the type: `wrapTopicPayload` keys
  // on the exact topic string, so `fleet.silence` delivers a Value where its
  // per-guid sibling delivers a bare number for the same field. A reader of
  // both has to accept either. Not arithmetic: the number is handed to the
  // caller and never computed with here.
  "packages/sitrep-client/src/wire-magnitude.ts": 1,
  // `readWireUt`, the one read of a universal time off a raw `alarm.scet` or
  // `alarm.scet.fired` frame, taken straight off the arrival rather than
  // through the store: the fired notice has to reach the client with the warp
  // stop rather than a light-time later, and the store samples at the frozen
  // view time. So the payload is `unknown` off the wire and the instant arrives
  // wrapped or bare depending on how the unit wrap keyed the topic, exactly the
  // boundary `wire-magnitude.ts` above documents. Not arithmetic: the number is
  // latched onto the alarm, or onto another screen's roster row for display,
  // and never computed with here.
  "packages/app/src/alarms/ScetAlarmBridge.ts": 1,
  // `canPropagate` accepts a horizon UT either wrapped (as the wire delivers it)
  // or already unwrapped, so one read normalises the two. Not arithmetic: the
  // number is compared against a window and never computed with.
  "mod/sitrep-sdk/src/spine/kepler.ts": 1,
  // The trajectory arc's points arrive either wrapped (as the wire delivers
  // them) or already unwrapped (as a caller-built fixture has them), so one read
  // normalises the two, exactly as `canPropagate`'s does above. Not arithmetic:
  // the numbers go into a rotation matrix as raw metres, which is geometry in a
  // single frame with a single unit and has no dimension for the algebra to
  // check.
  "mod/sitrep-sdk/src/spine/orbit-trajectory.ts": 1,
  "mod/sitrep-sdk/src/spine/orbit-patches.ts": 14,
  "mod/sitrep-sdk/src/spine/use-command.ts": 1,
  "packages/sitrep-client/src/use-control-stream.tsx": 2,
  "packages/ui-kit/src/Countdown.tsx": 1,
  /*
   * The four instrument primitives. Each one unwraps its axis ONCE per
   * quantity into the drawing's own coordinate space: an SVG path command, a
   * `y` pixel, a CSS width. That is the permanent kind of unwrap this budget's
   * own header names ("a d3 scale wants a number"), and it is what makes one
   * `U` across value, min, max, zones, ticks and markers belong on one scale
   * at all. Every figure a READER sees goes back out
   * through `writeQuantity` or `speakQuantity`.
   *
   * Tape spends the most because it has the most axis props (value, min, max,
   * tickStep, groundLine, plus a zone pair and a marker each). DivergingBar
   * spends ONE, on a quotient that `dividedBy` has already made dimensionless.
   *
   * Each of the three now funnels every OTHER quantity through one named step
   * onto its own geometry, so a zone bound, a marker and a band end share the
   * single unwrap rather than taking one each. What made that possible is the
   * comparison moving into the algebra: `min`/`max` convert before they
   * compare, where `Math.min` on two magnitudes orders a bound written on
   * another rung of the same kind by its bare number.
   *
   * The ordering and the emptiness of a zone stay decided on QUANTITIES rather
   * than on the pixels they become. Deciding them on the geometry would flip
   * every zone on a dial drawn with a negative sweep.
   */
  "packages/ui-kit/src/Dial.tsx": 5,
  "packages/ui-kit/src/DivergingBar.tsx": 1,
  "packages/ui-kit/src/Gauge.tsx": 4,
  "packages/ui-kit/src/Tape.tsx": 6,
  /*
   * ONE, and it is the fill fraction every primitive drawn from an
   * amount/capacity pair is derived by. Moved here from Meter.tsx, which held
   * the only copy until ProgressBar needed the same division: one unwrap
   * shared beats a second one written out, and this is the shape of budget
   * movement to want, since the next primitive to take a pair adds none.
   *
   * `dividedBy` has already checked the two halves are the same kind and made
   * the quotient dimensionless, so this unwraps a number that has stopped
   * being a quantity, into the two slots that cannot hold a unit: a CSS width
   * and an `aria-valuenow`.
   */
  "packages/ui-kit/src/fillQuantity.ts": 1,
  /*
   * 1, and it is the implementation: this is the ONE unwrap in the repo,
   * living here so `sitrep-sdk`'s own files can reach it without a cycle.
   * ui-kit re-exports it and spends none.
   */
  "mod/sitrep-sdk/src/magnitude.ts": 1,
  "packages/ui-kit/src/MissionDate.tsx": 1,
  /*
   * TWO, and both are the seam `units.ts` spends its one on: `formatQuantity`
   * takes the magnitude and the unit as two plain arguments, so a quantity
   * cannot be handed over whole. One is the single writer every end of the band
   * goes through, and the other is the figure itself.
   *
   * The two half-widths that used to sit here are gone: they are `minus` now,
   * which is the same dimension check `bandIn` has already applied to all three
   * ends.
   */
  "packages/ui-kit/src/Unit.tsx": 2,
  /*
   * ONE, on the same `formatQuantity` seam: the staleness caption renders the
   * reading's own `asOfUt` on the game's calendar through the formatter rather
   * than around it, so a held number and a `<MissionDate>` beside it cannot
   * print two spellings of one instant.
   */
  "packages/ui-kit/src/readingCurrency.ts": 1,
  /*
   * ONE, and it is the same fill fraction `fillQuantity.ts` spends its own on:
   * `Meter` takes the pair as two props, so the division belongs to this file,
   * and `fillQuantity` keeps its copy for `ProgressBar`, which still takes a
   * pair.
   *
   * `dividedBy` has already checked the two halves are the same kind and made
   * the quotient dimensionless, so this unwraps a number that has stopped being
   * a quantity, into the two slots that cannot hold a unit: a CSS width and an
   * `aria-valuenow`. Both the already-a-ratio path and the divided one converge
   * on it rather than each reading its own.
   */
  "packages/ui-kit/src/Meter.tsx": 1,
  /*
   * ONE: the seam where a quantity object meets `formatQuantity`, which takes
   * the magnitude and the unit as two arguments. `speakQuantity`,
   * `writeQuantity`, `quantityScale` and `readsAsOneFigure` all hand their
   * quantity over through `formatWhole`, which is this unwrap. Nothing
   * downstream of the seam sees a bare number, and no arithmetic happens on it.
   */
  "packages/ui-kit/src/units.ts": 1,
};

/**
 * Per-file `Value.toWire()` budget, on exactly the same terms as
 * {@link MAGNITUDE_BUDGET}: each entry EQUALS what its file uses, a file
 * absent from this map may not use any, and both arms below fail.
 *
 * Separate from the magnitude budget rather than folded into it, because the
 * two numbers answer different questions. A file's magnitude count is "how
 * much arithmetic escapes the algebra here"; its wire count is "how many
 * numeric slots does this file fill". Summing them would hide a rise in the
 * first behind a fall in the second, which is the confusion the split exists
 * to end.
 *
 * Budgeted rather than ignored on purpose. The point of naming the boundary
 * was to price it differently, not to stop pricing it: an exit that costs
 * nothing is the default path within a week, and this list is what makes a new
 * one get a sentence explaining itself.
 */
const WIRE_BUDGET: Record<string, number> = {
  /*
   * 1: the command boundary itself. `dehydrateArgs` is what takes a typed
   * command's quantities back down to the numbers the host binds, and it is the
   * write-side mirror of the wrap that gives an inbound payload its units. One
   * unwrap, in the walk, for the whole outbound command path.
   */
  "mod/sitrep-sdk/src/wrap-units.ts": 1,
  /*
   * 2: a reckoned tail's band ends, written into `SeriesReckonedSpan`'s
   * `bandLo`/`bandHi`, which are declared `number` because the series crosses
   * to the chart and then over PeerJS to a station. Nothing computes with them
   * here; the shading path in `lineChartMath` scales them into SVG coordinates.
   *
   * Those ends stay wrapped out of the store, and are unwrapped beside the
   * value they describe, at the one boundary this file's own magnitude entry
   * already names.
   */
  "packages/data/src/hooks/useDataSeries.ts": 2,
};

/**
 * Per-PACKAGE ceiling on calls to `magnitudeOf` and `magnitudeOr`. Otherwise
 * the same terms: each entry EQUALS its package's live count, a package absent
 * from this map may not call either, and both arms below fail.
 *
 * Per package rather than per file because the calls are spread thin. Most
 * files that make any make one to three, so a per-file map would be as long as
 * the set of calling files and its entries would carry no reason worth
 * reading. A package total still says where the growth is, and the failure
 * narrows that to the file by counting the same package at `HEAD`.
 *
 * What a total cannot do is stop one file growing while another in the same
 * package shrinks by as much. That is the price of a list short enough to be
 * read, and the shrink arm still makes every fall permanent.
 */
const FUNNEL_BUDGET: Record<string, number> = {
  "mod/GonogoBreakingGroundUplink": 2,
  // One of these is a held reading's `asOfUt` unwrapped for `ShipSystems`' number-typed `heldAsOfUt` prop.
  "mod/GonogoKerbalismUplink": 70,
  // One of these is `gapModel` comparing a bare `validAt` span against the wire's `time.warp.sampleIntervalUt`.
  "mod/sitrep-sdk": 30,
  // One of these is `GoNoGoHostService` measuring liftoff against `getViewUt()`, which returns a plain number.
  "packages/app": 9,
  "packages/components": 160,
  "packages/data": 5,
  "packages/ui-kit": 8,
};

/**
 * Used as a guard on the guard. If the search silently stops matching (a bad
 * regex, a moved root, a renamed extension) every count reads as zero and the
 * budget reports success while checking nothing.
 *
 * That is not hypothetical: `git grep -E` does not take `\b`, so a regex
 * written without accounting for that returns zero matches silently.
 *
 * Deliberately well under the real total, so ordinary shrinking never trips it.
 */
const MINIMUM_FILES_EXPECTED = 40;

const SEARCH_GLOBS = ["*.ts", "*.tsx"];

/**
 * A real property access: something identifier-ish, `)`, `]` or `?` sits
 * immediately before the dot. This is deliberately not a bare `\.magnitude`,
 * which also matches the two dozen comments that write the word in backticks
 * to explain why a particular unwrap is correct. Those are prose, and a budget
 * that counted them would charge a file for documenting itself.
 *
 * The `]` comes FIRST inside the bracket expression because POSIX has no
 * escaping in there: `[...\]...]` ends the class at the backslash, and the
 * whole pattern then silently matches nothing.
 */
const PROPERTY_ACCESS = String.raw`[]A-Za-z0-9_$)?]\.magnitude`;

/**
 * The named serialisation exit, {@link WIRE_BUDGET}'s subject.
 *
 * No leading character class is needed as `PROPERTY_ACCESS` needs one: the
 * call parentheses are what tell a use from prose, and a comment writing
 * `` `toWire()` `` in backticks does not carry them. The `\(\)` is therefore
 * load-bearing rather than decoration.
 */
const WIRE_ACCESS = String.raw`\.toWire\(\)`;

/**
 * The guard that makes the named exit a boundary rather than a laundering
 * route, and the reason `toWire()` could be introduced at all.
 *
 * `a.toWire() - b.toWire()` is the ORIGINAL defect in a better-sounding
 * spelling. Naming the act does nothing to stop it: it reads as deliberate,
 * which is worse than `.magnitude`, because `.magnitude` at least looks like
 * what it is. So a wire number may not be an operand of `+ - * / %`, and
 * unlike every other list in this file **this arm has no debt list**. There is
 * no honest instance of it. A number being computed with has not left the
 * algebra at a boundary; it is being computed with, and the algebra is what it
 * wants.
 *
 * Two patterns because the result can sit on either side of the operator, and
 * both are shaped to stay off BLOCK-COMMENT syntax, which a naive version does
 * not. A comment delimiter contains an asterisk and a slash, so both halves of
 * a comment wrapped around a mention of the exit look like multiplication and
 * division to a regex:
 *
 *  - the LEFT form requires a value-like character AFTER the operator. A
 *    comment CLOSER puts a slash there, and a slash is not value-like, so the
 *    asterisk that precedes it is not read as a multiplication
 *  - the RIGHT form requires one BEFORE it. A comment OPENER puts a slash
 *    there, so its asterisk is not read as one either. Its `.` in the trailing
 *    class is separately load-bearing: it is what lets the pattern see a
 *    dotted path, and without it `total + band.lo.toWire()` reads as clean,
 *    which was the first version's miss
 *
 * A unary `-a.toWire()` is deliberately NOT matched. It needs a value-like
 * character before the operator that a `= -` cannot supply, and a lone sign
 * flip is not the laundering shape; the per-file budget is what prices that.
 */
const WIRE_ARITHMETIC_PATTERNS = [
  String.raw`\.toWire\(\)[[:space:]]*[-+*/%][[:space:]]*[A-Za-z0-9_$(]`,
  String.raw`[]A-Za-z0-9_$)][[:space:]]*[-+*/%][[:space:]]*[A-Za-z0-9_$.]*\.toWire\(\)`,
];

/**
 * A call of either funnel, {@link FUNNEL_BUDGET}'s subject. The `(` is what
 * separates a call from an import or a `{@link}`.
 *
 * The leading class CONSUMES whatever identifier characters or backtick sit
 * before the name, and {@link isFunnelCall} then drops any match that picked
 * one up: `vecmagnitudeOf(` is another function, and a backticked
 * `magnitudeOf(x)` is prose. The more obvious `(^|[^A-Za-z0-9_$])` prefix
 * cannot be used, because `-o` takes matches without overlap, so in
 * `magnitudeOr(magnitudeOf(x), 0)` the first match swallows the `(` the
 * second one needs as its prefix and the inner call goes uncounted.
 */
const FUNNEL_CALL = "[A-Za-z0-9_$`]*magnitude(Of|Or)\\(";

function isFunnelCall(match: string): boolean {
  return match.startsWith("magnitude");
}

/** Where the pair is implemented, and so the one file whose calls are not uses. */
const FUNNEL_DEFINITION = "mod/sitrep-sdk/src/magnitude.ts";

/**
 * `-o` is what makes this scan count OCCURRENCES. Without it `git grep` emits
 * one record per matching LINE and the tally below counts records, so two
 * unwraps on one source line scored as one: sixteen lines across the tree were
 * under-counted that way, and joining two lines was a way to spend an unwrap
 * the budget could not see.
 *
 * Counting the matches in JavaScript instead is not available. `PROPERTY_ACCESS`
 * is POSIX ERE, where the leading `]` is a literal class member; `new RegExp`
 * reads the same text as an EMPTY class and then chokes on the `)`. The engine
 * that matches has to be the engine that counts.
 *
 * Shared with the planted check below on purpose. That check asserts a figure
 * only `-o` can produce, so the two together mean a silent return to line
 * counting fails rather than quietly halving a doubled line.
 */
const GREP_FLAGS = "-noE";

/**
 * Excluded from the budget:
 *  - `/dist/` build output, not source
 *  - tests and fixtures, which own the values they construct
 *  - `__generated__`, written by the contract generator
 *  - `unit-system/value.ts`, which IMPLEMENTS `.magnitude`
 */
const EXCLUDED =
  /\/dist\/|\.test\.|\.spec\.|test-d|__fixtures__|__generated__|unit-system\/value\.ts/;

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

/**
 * Whether a `git grep` failure is its "nothing matched" exit rather than a
 * real one.
 *
 * Both scans below need this and neither may swallow the other case: exit 1 is
 * an answer, and anything else is a broken search that must not be reported as
 * a clean tree.
 *
 * Narrowed by asking, not asserted. A caught value is `unknown`, and `in`
 * narrowing is what lets `status` be read off it without an `as` that would
 * also compile if the shape were something else entirely. See the remedy text
 * in `unknown-cast.test.ts`, which names exactly this route first.
 */
function isNoMatchExit(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    err.status === 1
  );
}

/**
 * `rev` scans a commit instead of the working tree, and `keep` sees each
 * match's text so a pattern can be narrowed after the engine that counts has
 * matched it.
 */
interface ScanOptions {
  rev?: string;
  keep?: (match: string) => boolean;
}

function countsByFile(
  root: string,
  pattern: string = PROPERTY_ACCESS,
  { rev, keep }: ScanOptions = {},
): Map<string, number> {
  let out: string;
  try {
    out = execFileSync(
      "git",
      /*
       * `--untracked` is load-bearing: `git grep` alone searches only TRACKED
       * files, so a violation introduced in a BRAND-NEW file is invisible to
       * this scan until the moment it is staged, and a local run before `git
       * add` reports success while not looking at it. It still honours
       * .gitignore, so build output stays out. A commit has no untracked
       * files, and git refuses the flag beside a revision. `GREP_FLAGS`
       * carries the `-o` that makes the tally below count occurrences rather
       * than matching lines; see its own note.
       */
      [
        "grep",
        ...(rev ? [] : ["--untracked"]),
        GREP_FLAGS,
        pattern,
        ...(rev ? [rev] : []),
        "--",
        ...SEARCH_GLOBS,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
    );
  } catch (err) {
    // git grep exits 1 when nothing matches. That is not a pass here: the whole
    // repo losing every magnitude at once is a broken search, and the file
    // floor below is what says so.
    if (isNoMatchExit(err)) return new Map();
    throw err;
  }
  const counts = new Map<string, number>();
  for (const raw of out.split("\n")) {
    const line =
      rev && raw.startsWith(`${rev}:`) ? raw.slice(rev.length + 1) : raw;
    if (!line || EXCLUDED.test(line)) continue;
    const fileEnd = line.indexOf(":");
    const file = line.slice(0, fileEnd);
    if (!file) continue;
    if (keep && !keep(line.slice(line.indexOf(":", fileEnd + 1) + 1))) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

/** The workspace a file belongs to: `packages/<name>` or `mod/<name>`. */
function packageOf(file: string): string {
  return file.split("/").slice(0, 2).join("/");
}

function funnelCountsByFile(root: string, rev?: string): Map<string, number> {
  const counts = countsByFile(root, FUNNEL_CALL, { rev, keep: isFunnelCall });
  counts.delete(FUNNEL_DEFINITION);
  return counts;
}

function totalsByPackage(counts: Map<string, number>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [file, used] of counts) {
    const pkg = packageOf(file);
    totals.set(pkg, (totals.get(pkg) ?? 0) + used);
  }
  return totals;
}

/**
 * The files in `pkg` that call the funnel more than they did at `HEAD`, which
 * is what a package total cannot say on its own. A growth that is already
 * committed has nothing to diff against, so then every calling file in the
 * package is listed, largest first, and the grown one is among them.
 */
function grownFunnelFiles(
  pkg: string,
  now: Map<string, number>,
  head: Map<string, number>,
): string[] {
  const inPkg = [...now].filter(([file]) => packageOf(file) === pkg);
  const grown = inPkg
    .filter(([file, used]) => used > (head.get(file) ?? 0))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, used]) => `    ${file}: ${head.get(file) ?? 0} -> ${used}`);
  if (grown.length > 0) return ["    grown since HEAD:", ...grown];
  return [
    "    no file differs from HEAD, so the growth is committed; every caller:",
    ...inPkg
      .sort(([fa, a], [fb, b]) => b - a || fa.localeCompare(fb))
      .map(([file, used]) => `    ${file}: ${used}`),
  ];
}

/**
 * Every workspace that can hold a call: each package under `packages/`, the
 * sdk, and each Uplink that ships a client. Read off the filesystem rather
 * than off the scan, so a walk that quietly narrowed cannot also narrow the
 * list it is checked against. A workspace is a directory with a
 * `package.json`, so one left behind holding only its `node_modules` is not
 * expected to have sources.
 */
function expectedRoots(root: string): string[] {
  const dirs = (parent: string) =>
    readdirSync(join(root, parent), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  const isWorkspace = (dir: string) =>
    existsSync(join(root, dir, "package.json"));
  return [
    ...dirs("packages")
      .map((d) => `packages/${d}`)
      .filter(isWorkspace),
    "mod/sitrep-sdk",
    ...dirs("mod")
      .filter((d) => /^Gonogo.*Uplink$/.test(d))
      .filter((d) => isWorkspace(`mod/${d}/client`))
      .map((d) => `mod/${d}`),
  ].sort();
}

/** The workspaces the scan's own walk reaches: every file it would search. */
function walkedRoots(root: string): Set<string> {
  const out = execFileSync(
    "git",
    ["grep", "--untracked", "-lE", ".", "--", ...SEARCH_GLOBS],
    { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
  );
  return new Set(out.split("\n").filter(Boolean).map(packageOf));
}

/**
 * Packages over their ceiling or absent from it, then packages under it. A
 * pure function of its inputs so the planted check can drive both arms with a
 * synthetic pair whose answer is known.
 */
function funnelCeilingBreaches(
  budget: Record<string, number>,
  totals: Map<string, number>,
): { over: string[]; stale: string[] } {
  const over: string[] = [];
  for (const [pkg, used] of [...totals].sort()) {
    const allowed = budget[pkg];
    if (allowed === undefined) over.push(`  ${pkg}: ${used} (not on the list)`);
    else if (used > allowed) over.push(`  ${pkg}: ${used}, ceiling ${allowed}`);
  }
  return { over, stale: staleEntries(budget, totals) };
}

/**
 * Entries sitting above what their file actually uses, formatted for the
 * failure. A pure function of the two inputs so the planted check below can
 * drive it with a synthetic pair whose answer is known: the shrink arm is the
 * half whose whole purpose is to make a stale number visible, so it being
 * silently broken would restore the exact defect it was added to fix.
 */
function staleEntries(
  budget: Record<string, number>,
  counts: Map<string, number>,
): string[] {
  const stale: string[] = [];
  for (const [file, allowed] of Object.entries(budget).sort()) {
    const used = counts.get(file) ?? 0;
    if (used < allowed) {
      stale.push(
        `  ${file}: ${allowed} -> ${used}${used === 0 ? " (delete the entry)" : ""}`,
      );
    }
  }
  return stale;
}

/**
 * Every line where a wire number is an operand of arithmetic, `file:line:text`.
 *
 * Unioned into ONE `git grep` rather than run per pattern, so a line matching
 * both forms (`a.toWire() - b.toWire()`, the canonical laundering shape) is
 * reported once. `-n` without `-o` is deliberate here: this arm reports lines
 * for a human to go and fix rather than counting occurrences, and the whole
 * line is what makes the report actionable.
 */
function wireArithmeticHits(root: string): string[] {
  try {
    return execFileSync(
      "git",
      [
        "grep",
        "--untracked",
        "-nE",
        WIRE_ARITHMETIC_PATTERNS.join("|"),
        "--",
        ...SEARCH_GLOBS,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
    )
      .split("\n")
      .filter((line) => line && !EXCLUDED.test(line));
  } catch (err) {
    // Exit 1 is "nothing matched", which for this arm is the goal state.
    if (isNoMatchExit(err)) return [];
    throw err;
  }
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * What an over-budget file is told to do instead, in the order the fixes are
 * usually needed: arithmetic, formatting, then the missing-API question.
 *
 * Named rather than inline so the guidance can be ASSERTED. Message text is the
 * part of a ratchet nothing else checks, so it rots quietly: a message that
 * stopped naming the fix would still fail the build, just uselessly, and every
 * test here would stay green while it happened.
 */
function magnitudeOverBudgetMessage(over: readonly string[]): string {
  return (
    "`.magnitude` is an escape hatch and these files reach for it more " +
    "than the budget allows. If the new use is arithmetic, do it in the " +
    "algebra (a.minus(b), value(unit, n), .in(unit)) instead.\n\n" +
    "IF THE NEW USE IS FORMATTING, it belongs to `<Unit>`: render " +
    "`<Unit value={x} />` rather than reading `x.magnitude` into a " +
    "template or a `toFixed`. Unit picks the rung and the precision, so " +
    "a hand-built string is both an unwrap and a second formatter. " +
    "Where a node genuinely cannot go (an SVG <text>, a contribution " +
    "`label`, an aria-label) use `writeQuantity` or `speakQuantity`, " +
    "which are the two sanctioned string escapes. " +
    "`styleguide-unit-exclusive` is the gate that owns this rule.\n\n" +
    "BEFORE RAISING THE COUNT, ask what method Value is missing. A count " +
    "that goes up because the algebra cannot express something is an API " +
    "gap: widen Value and the budget falls on its own. A count that goes " +
    "up because the method already exists and was not used is a mistake. " +
    "`isFinite()` was added to retire `Number.isFinite(x.magnitude)`, and " +
    "`min`/`max` take a bare operand so `x.max(0)` replaces " +
    "`Math.max(0, x.magnitude)`. See 'A budget entry is often a missing " +
    "API' in docs/ratchets.md.\n\n" +
    "RATIOS AND PRODUCTS ARE ALGEBRA TOO, and this is the family most " +
    "often missed: `a.per(b)` / `a.dividedBy(b)` return " +
    "`Value<Quotient<U, W>>` with the dimension checked at TYPE level, " +
    "and `.times()`, `.plus()`, `.greaterThan()` compare and combine " +
    "without unwrapping. A length over a length is NOT untyped: " +
    'definitions.ts declares `"1"` as dimensionless, so `m.per(m)` is a ' +
    'real `Value<"1">`. Four unwraps in one function were removed on ' +
    "exactly this ground. ASSOCIATION MATTERS: " +
    "`delay.times(hop.per(total))` types, while " +
    "`hop.times(delay).per(total)` degrades because `m*s` is not a " +
    "declared dimension.\n\n" +
    "Only a genuine boundary earns an entry: a plain-number return type, " +
    "a third-party call, a wire shape you do not own. Raise the count " +
    "here only then, and say which boundary it is:\n" +
    over.join("\n")
  );
}

describe("the magnitude budget only shrinks", () => {
  const counts = countsByFile(root);

  it("is actually looking at the codebase", () => {
    expect(counts.size).toBeGreaterThanOrEqual(MINIMUM_FILES_EXPECTED);
  });

  it("can see a violation (planted)", () => {
    /*
     * The file floor above catches a walk that stops finding files. It cannot
     * catch a walk that finds them and a PATTERN that stops matching, which is
     * the failure this regex has already had once: `git grep -E` takes no `\b`,
     * and the first version of it matched nothing and reported a clean tree.
     *
     * Planted through `git grep` itself, never `new RegExp(PROPERTY_ACCESS)`.
     * The two are not the same pattern: this is POSIX ERE, where the leading
     * `]` in `[]A-Za-z0-9_$)?]` is a literal member of the class, while
     * JavaScript reads `[]` as an EMPTY class and then chokes on the unmatched
     * `)`. A JS-side check would either throw or, with the brackets respelt to
     * make it parse, pass while measuring a pattern the scan never runs. The
     * instrument has to be the engine under test.
     */
    const planted = join(mkdtempSync(join(tmpdir(), "mag-ratchet-")), "p.ts");
    try {
      writeFileSync(
        planted,
        [
          "const a = reading.magnitude;", // identifier before the dot
          "const b = readings[0].magnitude;", // `]`, the class's first member
          "const c = f().magnitude;", // `)`
          "const d = maybe?.magnitude;", // optional chain
          "const e = [v.x.magnitude, v.y.magnitude];", // TWO on one line
          "// prose about `.magnitude` is not a use of it",
        ].join("\n"),
      );
      /*
       * `cwd` is the temp dir, which sits outside any repository: `git grep
       * --no-index` refuses a path outside the repo it finds from cwd, so
       * running it from inside this checkout would fail on the path rather than
       * answer about the pattern.
       */
      const hits = execFileSync(
        "git",
        ["grep", "--no-index", GREP_FLAGS, PROPERTY_ACCESS, "--", "p.ts"],
        { cwd: dirname(planted), encoding: "utf8" },
      )
        .trim()
        .split("\n");
      /*
       * Six uses seen across five lines, and the comment line not charged: a
       * budget that billed a file for explaining itself is how the
       * explanations get deleted.
       *
       * Six rather than five is the second thing this pins. `-o` is what makes
       * the scan count occurrences instead of matching LINES, and dropping it
       * silently halves the doubled line's contribution rather than breaking
       * anything. Asserting a figure only `-o` can produce is what stops the
       * scan quietly going back to under-counting.
       */
      expect(hits).toHaveLength(6);
    } finally {
      rmSync(dirname(planted), { recursive: true, force: true });
    }
  });

  it("can see a stale entry (planted)", () => {
    /*
     * The shrink arm's own guard-on-the-guard. The two planted checks around it
     * prove the SCAN can still see a violation; neither says anything about the
     * comparison that turns a scan result into a stale-entry failure, and a
     * comparison that stopped comparing would report a tight list forever.
     * That is not a hypothetical failure mode, it is the one this arm exists to
     * fix: on the sibling styled-components ratchet the equivalent signal was a
     * `console.warn` into a suppressed stream, which is indistinguishable from
     * no signal at all and stayed that way through thirty imports.
     *
     * Synthetic inputs, because the real tree is tight and a tight tree cannot
     * demonstrate the arm firing.
     */
    const stale = staleEntries(
      { over: 4, exact: 2, gone: 1, absent: 3 },
      new Map([
        ["over", 2],
        ["exact", 2],
        ["gone", 0],
      ]),
    );
    expect(stale).toEqual([
      "  absent: 3 -> 0 (delete the entry)",
      "  gone: 1 -> 0 (delete the entry)",
      "  over: 4 -> 2",
    ]);
    // A file at its number is not stale, and a file OVER it is the other arm's
    // business: this one must stay silent on both or it double-reports.
    expect(
      staleEntries(
        { exact: 2, under: 1 },
        new Map([
          ["exact", 2],
          ["under", 5],
        ]),
      ),
    ).toEqual([]);
  });

  it("has no entry for a path that no longer exists", () => {
    /*
     * A budget entry for a file that is gone can never be spent, so it never
     * trips the over-budget arm and never gets removed: it is pure slack that
     * no run reports.
     */
    const missing = Object.keys(MAGNITUDE_BUDGET)
      .filter((rel) => !existsSync(join(root, rel)))
      .sort();
    expect(missing, "budgeted paths that no longer exist, delete them").toEqual(
      [],
    );
  });

  it("has no entry above what its file actually uses", () => {
    /*
     * The shrink arm, and the reason the sum of this list is exactly the live
     * count rather than comfortably above it. An entry of 4 on a file that uses
     * 2 is not a record of anything: it is permission for two more, and the
     * over-budget arm below cannot see them because they fit.
     *
     * Vitest 4's default reporter suppresses console output for a PASSING
     * test, so a `console.warn` here would reach no stream anyone reads.
     * Failing is the only signal that can be tested by planting a shrink.
     *
     * Not a new contract so much as a consistent one: the sibling test above
     * already hard-fails a budget entry whose file was DELETED. A file that
     * merely dropped half its unwraps is the same stale slack, caught later.
     *
     * Lowering is by hand on purpose. There is no `--update`, so a number that
     * was CHOSEN and explained in a comment above it can never be quietly
     * rewritten by a tool: the failure hands you the figure and makes you walk
     * past the reasoning to type it.
     */
    const stale = staleEntries(MAGNITUDE_BUDGET, counts);
    if (stale.length > 0) {
      throw new Error(
        "These entries sit above what their file uses, and the gap is " +
          "permission for that many new unwraps which the over-budget check " +
          "cannot see. Lower each one (or delete it, where the file now uses " +
          "none) in packages/core/src/styleguide-magnitude-budget.test.ts. If " +
          "an entry carries a comment, read it first: the number was chosen, " +
          "and the note may need rewriting rather than deleting:\n" +
          stale.join("\n"),
      );
    }
    expect(stale).toEqual([]);
  });

  it("has no file over its budget, and no unbudgeted file using one", () => {
    const over: string[] = [];
    for (const [file, used] of [...counts].sort()) {
      const budget = MAGNITUDE_BUDGET[file];
      if (budget === undefined) {
        over.push(`  ${file}: ${used} (not on the list)`);
      } else if (used > budget) {
        over.push(`  ${file}: ${used}, budget ${budget}`);
      }
    }
    if (over.length > 0) {
      throw new Error(magnitudeOverBudgetMessage(over));
    }
    expect(over).toEqual([]);
  });

  /**
   * The failure NAMES THE FIX, which is the half of a ratchet that decides
   * whether anyone acts on it.
   *
   * The operator asked for the `<Unit>` notice specifically: an unwrap done in
   * order to FORMAT is the commonest kind, and the algebra advice above it does
   * not answer that case at all, so a reader doing it was told to reach for
   * `minus`/`per` when what they needed was a component.
   *
   * Asserted on the offending list too, because guidance with no filenames
   * under it is a lecture rather than a report.
   */
  it("tells an over-budget file what to do instead, formatting included", () => {
    const message = magnitudeOverBudgetMessage([
      "  packages/components/src/Example/index.tsx: 3, budget 1",
    ]);

    expect(message).toContain("<Unit value={x} />");
    expect(message).toContain("writeQuantity");
    expect(message).toContain("speakQuantity");
    expect(message).toContain("a.minus(b)");
    expect(message).toContain("docs/ratchets.md");
    expect(message).toContain(
      "packages/components/src/Example/index.tsx: 3, budget 1",
    );
  });
});

describe("the named wire exit is priced, not exempt", () => {
  const counts = countsByFile(root, WIRE_ACCESS);

  it("can see a use, and does not charge prose for the word (planted)", () => {
    /*
     * The same guard-on-the-guard the magnitude scan carries, for the same
     * reason: a pattern that stops matching reports every file at zero, and a
     * budget of zeroes passes while checking nothing. This one has a second
     * job. `WIRE_ACCESS` has no leading character class, so the `\(\)` is the
     * ONLY thing separating a call from a mention, and a version that dropped
     * it would charge this very file for its own documentation.
     */
    const planted = join(mkdtempSync(join(tmpdir(), "wire-ratchet-")), "p.ts");
    try {
      writeFileSync(
        planted,
        [
          "sample.bandLo = band.lo.toWire();",
          "sample.bandHi = band.hi.toWire();",
          "const both = [a.toWire(), b.toWire()];", // TWO on one line
          "// prose about `toWire` is not a use of it",
          "// nor is a bare mention of toWire without its parentheses",
        ].join("\n"),
      );
      const hits = execFileSync(
        "git",
        ["grep", "--no-index", GREP_FLAGS, WIRE_ACCESS, "--", "p.ts"],
        { cwd: dirname(planted), encoding: "utf8" },
      )
        .trim()
        .split("\n");
      // Four uses across three lines, and neither prose line charged.
      expect(hits).toHaveLength(4);
    } finally {
      rmSync(dirname(planted), { recursive: true, force: true });
    }
  });

  it("has no entry for a path that no longer exists", () => {
    const missing = Object.keys(WIRE_BUDGET)
      .filter((rel) => !existsSync(join(root, rel)))
      .sort();
    expect(missing, "budgeted paths that no longer exist, delete them").toEqual(
      [],
    );
  });

  it("has no entry above what its file actually uses", () => {
    const stale = staleEntries(WIRE_BUDGET, counts);
    if (stale.length > 0) {
      throw new Error(
        "These `toWire()` entries sit above what their file uses, and the gap " +
          "is permission for that many new exits which the over-budget check " +
          "cannot see. Lower each one, or delete it where the file now uses " +
          "none:\n" +
          stale.join("\n"),
      );
    }
    expect(stale).toEqual([]);
  });

  it("has no file over its budget, and no unbudgeted file using one", () => {
    const over: string[] = [];
    for (const [file, used] of [...counts].sort()) {
      const budget = WIRE_BUDGET[file];
      if (budget === undefined) {
        over.push(`  ${file}: ${used} (not on the list)`);
      } else if (used > budget) {
        over.push(`  ${file}: ${used}, budget ${budget}`);
      }
    }
    if (over.length > 0) {
      throw new Error(
        "`Value.toWire()` is the SERIALISATION exit and these files reach for " +
          "it more than the budget allows.\n\n" +
          "It is named so that filling a numeric slot can be told apart from " +
          "discarding a dimension to compute, NOT so that leaving the type " +
          "system is free. Before raising a count, check which act this is. " +
          "If the number is about to be computed with, `toWire()` is the wrong " +
          "method however plainly the slot is typed `number`: reach for the " +
          "algebra (a.minus(b), a.per(b), a.lessThanOrEqual(b)) instead.\n\n" +
          "Only a genuine numeric SLOT earns an entry: a declared `number` " +
          "field of a serialisable shape, a typed sample buffer, a wire " +
          "payload read by code you do not own. Raise the count here only " +
          "then, and say which slot it is:\n" +
          over.join("\n"),
      );
    }
    expect(over).toEqual([]);
  });

  it("can see arithmetic on a wire number, both ways round (planted)", () => {
    /*
     * The load-bearing plant. Every other arm here counts, and a count can be
     * argued up; this one refuses a SHAPE and has no debt list, so it is the
     * only thing standing between a named exit and an uncounted one.
     *
     * A regex that silently stopped matching would report a clean tree
     * forever, which is precisely how the exit becomes the escape. Both
     * directions are planted, and so are the comment forms that the first
     * version of these patterns matched by accident: a scan that fires on
     * a comment wrapped around a mention of it gets deleted rather than fixed.
     */
    const dir = mkdtempSync(join(tmpdir(), "wire-arith-"));
    const planted = join(dir, "p.ts");
    try {
      writeFileSync(
        planted,
        [
          "const w1 = a.toWire() - b.toWire();", // the canonical laundering shape
          "const w2 = 5 - b.toWire();", // right operand, bare left
          "const w3 = a.toWire() * 2;", // left operand
          "const w4 = a.toWire()/n;", // no surrounding space
          "const w5 = total + band.lo.toWire();", // right operand, DOTTED path
          "const w6 = span[0] % other.hi.toWire();", // `]` before the operator
          "sample.bandLo = band.lo.toWire();", // the honest use
          "const xs = [a.toWire(), b.toWire()];", // a comma is not an operator
          "const f = () => a.toWire();", // nor is an arrow
          "return band.hi.toWire();",
        ].join("\n"),
      );
      const hits = execFileSync(
        "git",
        [
          "grep",
          "--no-index",
          "-nE",
          WIRE_ARITHMETIC_PATTERNS.join("|"),
          "--",
          "p.ts",
        ],
        { cwd: dir, encoding: "utf8" },
      )
        .trim()
        .split("\n");
      /*
       * Six, which pins BOTH halves. Fewer means a form stopped being seen
       * (the dotted path and the `]` are the two that have actually gone
       * missing); more means the patterns have started charging the four
       * honest lines below them, and a guard that fires on
       * `sample.bandLo = band.lo.toWire()` is one nobody will keep.
       */
      expect(hits).toHaveLength(6);
      expect(hits.every((h) => /w[1-6]/.test(h))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("has no arithmetic on a wire number anywhere in the tree", () => {
    const hits = wireArithmeticHits(root);
    if (hits.length > 0) {
      throw new Error(
        "A `toWire()` result is an operand of arithmetic here, and there is " +
          "no budget entry to raise: this is the defect the magnitude budget " +
          "exists for, wearing the name of the exit that was added to get " +
          "AROUND looking like it.\n\n" +
          "A number being computed with has not crossed a boundary. Do the " +
          "arithmetic in the algebra (a.minus(b), a.times(n), a.per(b)) and " +
          "cross the boundary once, at the end, with the result:\n" +
          hits.join("\n"),
      );
    }
    expect(hits).toEqual([]);
  });
});

describe("the magnitude funnel is priced, not exempt", () => {
  const counts = funnelCountsByFile(root);
  const totals = totalsByPackage(counts);

  it("walks every workspace that can hold a call", () => {
    /*
     * A scan that stopped reaching a workspace reports that workspace at zero,
     * and zero passes. The roots come from the filesystem and are checked
     * against what the walk itself saw, so a narrowed walk fails here rather
     * than reading as a clean package.
     */
    const expected = expectedRoots(root);
    const walked = walkedRoots(root);
    expect(expected).toEqual(
      expect.arrayContaining(["mod/sitrep-sdk", "packages/components"]),
    );
    expect(
      expected.filter((r) => !walked.has(r)),
      "workspaces the scan did not walk",
    ).toEqual([]);
    expect(
      Object.keys(FUNNEL_BUDGET).filter((pkg) => !expected.includes(pkg)),
      "ceilings on a workspace that no longer exists, delete them",
    ).toEqual([]);
  });

  it("counts a call, and nothing that only names one (planted)", () => {
    const dir = mkdtempSync(join(tmpdir(), "funnel-ratchet-"));
    try {
      writeFileSync(
        join(dir, "p.ts"),
        [
          'import { magnitudeOf, magnitudeOr } from "@ksp-gonogo/ui-kit";',
          "const a = magnitudeOf(x);",
          "const b = magnitudeOr(y, 0);",
          "const c = magnitudeOr(magnitudeOf(z), 1);", // TWO, one inside the other
          "const d = sdk.magnitudeOf(w);",
          "const e = vecmagnitudeOf(v);", // a different function
          "// prose about `magnitudeOf(x)` is not a use of it",
          "/** See {@link magnitudeOr} for the default. */",
        ].join("\n"),
      );
      const matches = execFileSync(
        "git",
        ["grep", "--no-index", GREP_FLAGS, FUNNEL_CALL, "--", "p.ts"],
        { cwd: dir, encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .map((line) => line.split(":").slice(2).join(":"));
      /*
       * Five. Fewer means the nested call went uncounted, which is what the
       * obvious prefix does; more means the prose, the link or the other
       * function started being charged.
       */
      expect(matches.filter(isFunnelCall)).toHaveLength(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails a package over its ceiling, absent from it, or under it (planted)", () => {
    const { over, stale } = funnelCeilingBreaches(
      { "packages/a": 3, "packages/b": 2, "packages/c": 4 },
      new Map([
        ["packages/a", 3],
        ["packages/b", 5],
        ["packages/c", 1],
        ["packages/new", 1],
      ]),
    );
    expect(over).toEqual([
      "  packages/b: 5, ceiling 2",
      "  packages/new: 1 (not on the list)",
    ]);
    expect(stale).toEqual(["  packages/c: 4 -> 1"]);
  });

  it("names the file that grew", () => {
    const now = new Map([
      ["packages/a/src/x.ts", 4],
      ["packages/a/src/y.ts", 1],
      ["packages/b/src/z.ts", 9],
    ]);
    expect(
      grownFunnelFiles(
        "packages/a",
        now,
        new Map([["packages/a/src/x.ts", 2]]),
      ),
    ).toEqual([
      "    grown since HEAD:",
      "    packages/a/src/x.ts: 2 -> 4",
      "    packages/a/src/y.ts: 0 -> 1",
    ]);
    expect(grownFunnelFiles("packages/a", now, now)).toEqual([
      "    no file differs from HEAD, so the growth is committed; every caller:",
      "    packages/a/src/x.ts: 4",
      "    packages/a/src/y.ts: 1",
    ]);
    // The diff is only useful if HEAD can be read at all.
    expect(funnelCountsByFile(root, "HEAD").size).toBeGreaterThan(0);
  });

  it("has no package over its ceiling, under it, or absent from it", () => {
    const { over, stale } = funnelCeilingBreaches(FUNNEL_BUDGET, totals);
    if (over.length > 0) {
      const head = funnelCountsByFile(root, "HEAD");
      const detail = over.flatMap((entry) => [
        entry,
        ...grownFunnelFiles(entry.trim().split(":")[0] ?? "", counts, head),
      ]);
      throw new Error(
        "`magnitudeOf` and `magnitudeOr` are the `.magnitude` escape hatch " +
          "behind a function, and these packages call them more than the " +
          "ceiling allows. The same advice applies as to `.magnitude` itself: " +
          "arithmetic belongs in the algebra (a.minus(b), a.per(b), .in(unit)), " +
          "and a figure going on screen belongs to `<Unit>`, `writeQuantity` " +
          "or `speakQuantity`. Only a genuine plain-number boundary earns a " +
          "raise, and the commit that raises a ceiling says which boundary:\n" +
          detail.join("\n"),
      );
    }
    if (stale.length > 0) {
      throw new Error(
        "These funnel ceilings sit above what their package calls, and the " +
          "gap is permission for that many new calls. Lower each one, or " +
          "delete it where the package now calls neither:\n" +
          stale.join("\n"),
      );
    }
    expect({ over, stale }).toEqual({ over: [], stale: [] });
  });
});
