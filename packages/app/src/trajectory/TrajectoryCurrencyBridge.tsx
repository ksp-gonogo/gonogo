import { useTelemetry } from "@ksp-gonogo/core";
import {
  canPropagate,
  mapTopic,
  type PropagationRefusal,
  TrajectoryKindLike,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import type { Severity } from "@ksp-gonogo/ui-kit";
import { magnitudeOf, useStatusContribution } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";

/** The one wire payload that carries a propagation horizon. */
const TRAJECTORY_TOPIC = "vessel.orbit";

/**
 * Whether this widget draws numbers out of the trajectory payload, and is
 * therefore a widget the horizon has something to say about.
 *
 * Containment walks DOWN from the declaration into the payload's fields, never
 * UP from a derived field to the inputs it was computed from, which is the same
 * direction rule `alarmMatchesWidget` follows and for the same reason. Walking
 * up would light every `vessel.state` widget: that channel has seven inputs and
 * `vessel.orbit` is one of them, so a widget reading `vessel.state.throttle`
 * would badge PAST HORIZON on a trajectory problem that cannot touch a throttle
 * reading. A badge that cries wolf is a badge nobody reads, and this one exists
 * to be believed.
 *
 * The cost of that rule is a real gap, named here rather than left to be
 * discovered: a widget reading an orbit-derived field THROUGH `vessel.state`
 * (`apoapsisAlt` and friends) genuinely is affected and does not light. Closing
 * it needs per-field provenance on the derived channel, so the channel can say
 * which of its fields descend from which input. Nothing here can infer that,
 * and guessing in this direction is the loud-false-positive trade above.
 */
export function widgetReadsTrajectory(
  dataRequirements: readonly string[] | undefined,
): boolean {
  for (const requirement of dataRequirements ?? []) {
    const topic = mapTopic("data", requirement) ?? requirement;
    if (topic === TRAJECTORY_TOPIC) return true;
    if (topic.startsWith(`${TRAJECTORY_TOPIC}.`)) return true;
  }
  return false;
}

/**
 * What a widget's panel should say about its trajectory's currency, or `null`
 * when the horizon has nothing to add.
 *
 * The instant that matters is the VIEW instant, not the sample's own: a producer
 * is always current with itself, and an operator reading a delayed second screen
 * is not. Asking `canPropagate` for `[viewUt, viewUt]` is asking exactly
 * the operator's question, "can these elements answer for the moment I am
 * looking at", which is why both ends are the view instant.
 *
 * The two refusals are deliberately NOT collapsed into one badge. "You have
 * outrun a stated bound" and "nobody stated a bound" are different facts with
 * different remedies, and a single label covering both would be the confident
 * wrong answer this seam exists to remove. Outrunning a stated horizon is the
 * `warning`: the producer named a limit and the screen is past it, which is a
 * fact about this reading. An unstated horizon is a `caution`: it may well be
 * fine, but nothing has said so, and silence must not render as health.
 *
 * Inside the window an INTEGRATED trajectory still contributes, at `info`: its
 * elements are a snapshot of a path, exact at the sample instant and drifting
 * from there, so a conic drawn through them is an approximation even before the
 * horizon is reached. An analytic trajectory inside its window contributes
 * nothing, because there is nothing to say: a closed-form conic is as good at
 * the view instant as at the sample. A producer that states an unbounded
 * horizon without naming a kind also contributes nothing, having answered the
 * question that was asked (reach) and left one that is not actionable on its
 * own (shape).
 *
 * Labels are short because `Badge` sets `white-space: nowrap` and the panel
 * header has no ellipsis to fall back on, so a long label pushes the title
 * rather than truncating. `BEYOND INTEGRATION` is preferred over qualifying
 * `PAST HORIZON` with the kind: it is shorter AND it says the more useful
 * thing, that the integrator has not computed this far yet, which is a state
 * that resolves on its own where an analytic trajectory claiming a bound is a
 * producer bug that does not.
 */
export function trajectoryCurrencyContribution(
  refusal: PropagationRefusal,
  trajectoryKind: TrajectoryKindLike | undefined,
): { severity: Severity; label: string } | null {
  if (!refusal.propagatable) {
    if (refusal.reason === "no-horizon-stated") {
      return { severity: "caution", label: "NO HORIZON STATED" };
    }
    return {
      severity: "warning",
      label:
        refusal.trajectoryKind === TrajectoryKindLike.Integrated
          ? "BEYOND INTEGRATION"
          : "PAST HORIZON",
    };
  }
  if (trajectoryKind === TrajectoryKindLike.Integrated) {
    return { severity: "info", label: "EXACT AT SAMPLE" };
  }
  return null;
}

/**
 * Bridges the trajectory's own declared propagation horizon into the per-widget
 * `PanelStatusStore`, so a widget drawing orbital numbers says whether those
 * numbers can answer for the instant on screen.
 *
 * This is the surface the in-game overlay cannot have. An in-game plot is drawn
 * by the process that owns the integrator, at the instant it owns; it is current
 * with itself by construction and has no way to be otherwise. A mission-control
 * screen is a different clock, possibly a delayed one, possibly a paused or
 * scrubbed one, and "these elements cannot answer for what you are looking at"
 * is a sentence only this side can say.
 *
 * Rendered once per grid item, beside `AlarmStatusBridge` and scoped the same
 * way. Widgets that draw nothing from the trajectory mount no inner component at
 * all, so they pay no subscription for a badge that could never fire.
 */
export function TrajectoryCurrencyBridge({
  dataRequirements,
}: {
  dataRequirements: readonly string[] | undefined;
}) {
  // Resolved on the joined list rather than the array: `registerComponent`
  // hands back a fresh array identity on some read paths, and this decides
  // whether a subscribing child is mounted at all.
  const key = (dataRequirements ?? []).join(" ");
  const reads = useMemo(
    () => widgetReadsTrajectory(key.length > 0 ? key.split(" ") : []),
    [key],
  );
  return reads ? <TrajectoryCurrencyContribution /> : null;
}

/**
 * The trajectory read and the contribution, mounted only for widgets that draw
 * from it.
 *
 * A `pending` or `absent` reading contributes nothing: "no trajectory has
 * arrived" is the stream badge's sentence, and saying it twice in two
 * vocabularies would make the panel less clear, not more. A `stale` reading is
 * likewise the stream badge's judgement. This bridge speaks only about a
 * trajectory it actually has, and `reckonable` counts as having one: a reckoned
 * value is still elements with a horizon attached, and whether that horizon
 * covers the view instant is precisely the question worth asking about it.
 *
 * With no view UT there is no question to ask, so nothing is contributed rather
 * than a guess substituted. That is the case on a screen whose clock has not
 * started, and inventing a wall-clock instant for it would answer a question
 * about the mission with a fact about the browser.
 */
function TrajectoryCurrencyContribution() {
  const reading = useTelemetry(TRAJECTORY_TOPIC);
  const viewUt = magnitudeOf(useViewUt());
  const orbit =
    reading.state === "observed"
      ? reading.value
      : reading.state === "reckonable"
        ? reading.reckoned.value
        : undefined;
  const contribution =
    orbit === undefined || viewUt === null
      ? null
      : trajectoryCurrencyContribution(
          canPropagate(orbit.horizon, viewUt, viewUt),
          orbit.horizon?.trajectoryKind,
        );
  useStatusContribution(
    contribution === null
      ? null
      : { id: "trajectory-currency", ...contribution },
  );
  return null;
}
