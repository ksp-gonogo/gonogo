import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  registerAugment,
  useTelemetry,
  useViewUt,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  Countdown,
  magnitudeOf,
  NULL_DISPLAY,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type {
  PrincipiaFlightPlan,
  PrincipiaFlightPlanBurn,
} from "../__generated__/contract";
import { PRINCIPIA } from "../uplink";
// Side-effect import: hydrates this Topic's units at decode time and augments
// the payload map for the type. Pulled in here rather than left to the entry
// point's import order, because this file is the consumer that would silently
// receive bare numbers without it.
import "../topics";

/**
 * The plan as last SEEN, plus how long ago that was.
 *
 * <para>Every arm of the reading is handled and none is collapsed, which is the
 * whole point of the widget. A `stale` plan is shown, loudly dated: an operator
 * who can see that the plan was last observed six hours ago can act on it,
 * where one shown nothing assumes there is nothing. And an unobserved plan is
 * shown as UNOBSERVED rather than as an empty plan, because the producer cannot
 * distinguish "no plan" from "the planner has never been opened" and neither can
 * this.</para>
 */
type PlanView =
  | { kind: "unobserved" }
  | { kind: "seen"; plan: PrincipiaFlightPlan; observedAtUt: number | null };

function planView(reading: Reading<PrincipiaFlightPlan>): PlanView {
  switch (reading.state) {
    case "pending":
    case "absent":
      return { kind: "unobserved" };
    case "observed":
      return {
        kind: "seen",
        plan: reading.value,
        observedAtUt: magnitudeOf(reading.atUt),
      };
    case "stale":
    case "reckonable":
      return {
        kind: "seen",
        plan: reading.value,
        observedAtUt: magnitudeOf(reading.asOfUt),
      };
  }
}

/**
 * How the plan's integration went, as something an operator can act on.
 *
 * The three-state verdict survives to here rather than being flattened. An
 * unreadable status is its own row and its own severity, because "we could not
 * check" asks the operator to go and look and "it integrated" asks nothing.
 * Collapsing them would answer the question the producer refused to.
 */
function integrationBadge(plan: PrincipiaFlightPlan) {
  if (plan.planIntegrated === false) {
    const burn = magnitudeOf(plan.firstErrorBurnIndex);
    return (
      <Badge severity="critical">
        {burn === null
          ? "INTEGRATION FAILED"
          : `INTEGRATION FAILED AT BURN ${burn + 1}`}
      </Badge>
    );
  }
  if (plan.planIntegrated == null) {
    return <Badge severity="caution">INTEGRATION STATUS UNKNOWN</Badge>;
  }
  return <Badge severity="nominal">INTEGRATED</Badge>;
}

/**
 * One burn row.
 *
 * The ignition instant is turned into a duration before it reaches
 * `<Countdown>`, which is the operation that makes an instant a countdown at
 * all: an absolute UT handed straight to a duration renderer reads as a
 * plausible interval decades long.
 *
 * The countdown is measured from the VIEW instant, not from the plan's
 * observation instant. An ignition four minutes after a snapshot taken six
 * hours ago is not four minutes away, it is long past, and the operator needs
 * the second answer.
 */
function BurnRow({
  burn,
  viewUt,
  isNext,
}: {
  burn: PrincipiaFlightPlanBurn;
  viewUt: number | null;
  isNext: boolean;
}) {
  const ignitionUt = magnitudeOf(burn.ignitionUt);
  const untilIgnition =
    ignitionUt === null || viewUt === null ? null : ignitionUt - viewUt;
  const index = magnitudeOf(burn.index);
  return (
    <Cluster data-burn-row="">
      <Text>{index === null ? NULL_DISPLAY : `#${index + 1}`}</Text>
      <Text>
        {untilIgnition === null ? (
          NULL_DISPLAY
        ) : (
          <Countdown value={untilIgnition} clock />
        )}
      </Text>
      <Text>
        {burn.deltaV == null ? (
          NULL_DISPLAY
        ) : (
          <Unit value={burn.deltaV} decimals={1} />
        )}
      </Text>
      <Text>
        {burn.durationSeconds == null ? (
          NULL_DISPLAY
        ) : (
          <Unit value={burn.durationSeconds} decimals={0} />
        )}
      </Text>
      {isNext && <Badge severity="info">NEXT</Badge>}
      {burn.anomalous === true && <Badge severity="warning">ANOMALOUS</Badge>}
    </Cluster>
  );
}

/**
 * The n-body flight plan, mirrored into the maneuver planner.
 *
 * <para><b>What the in-game window cannot do, and this can: wake you for an
 * ignition.</b> A finite burn has an ignition instant and a long coast before
 * it, and the operator is elsewhere for the coast. The plan exists in a window
 * on another machine; the countdown that matters has to be on the screen they
 * are actually looking at.</para>
 *
 * <para><b>And it cannot tell you its own numbers are stale, because it only
 * draws them when they are fresh.</b> The producer's fields are refreshed only
 * while that window renders, so the plan reaching here is an observation with an
 * instant attached, and this widget's first job is to say which instant. That is
 * not a caveat bolted onto a mirror, it is the thing the mirror adds.</para>
 *
 * <para>Bound to `maneuver-planner.sections`, the whole-widget append slot that
 * already exists for exactly this: an Uplink with an alternate transfer strategy
 * to show below the built-in preview. So the host widget needed no edit at
 * all.</para>
 */
export function FlightPlanSection() {
  const view = planView(useTelemetry("principia.flightPlan"));
  const identity = useTelemetry("vessel.identity");
  const viewUt = magnitudeOf(useViewUt());

  if (view.kind === "unobserved") {
    return (
      <Section data-flight-plan-section="">
        <SectionTitle>N-BODY FLIGHT PLAN</SectionTitle>
        <Stack role="status" aria-live="polite">
          <Badge severity="caution">PLAN NOT OBSERVED</Badge>
          {/* Deliberately not "no flight plan". The producer can only read the
              plan while the game's own planner window is drawing it, so silence
              here means nobody has looked, which is a different fact and the
              more dangerous one to get wrong: an operator told "no plan" for a
              vessel that has one stops looking. */}
          <Text>
            Open the flight planner in-game once and the plan will appear here,
            dated.
          </Text>
        </Stack>
      </Section>
    );
  }

  const { plan, observedAtUt } = view;
  const age =
    observedAtUt === null || viewUt === null ? null : viewUt - observedAtUt;
  const activeVesselId = vesselIdOf(identity);
  const isOtherVessel =
    activeVesselId !== null &&
    plan.vesselId != null &&
    plan.vesselId !== activeVesselId;

  return (
    <Section data-flight-plan-section="">
      <SectionTitle>N-BODY FLIGHT PLAN</SectionTitle>
      <Stack>
        <Cluster>
          {/* The age is the headline, not a footnote. A zero-age plan is being
              drawn right now; anything else is a snapshot and says so. */}
          {age === null ? (
            <Badge severity="caution">OBSERVED AT AN UNKNOWN TIME</Badge>
          ) : age <= 0 ? (
            <Badge severity="nominal">OBSERVED NOW</Badge>
          ) : (
            <Badge severity="caution">
              OBSERVED <Countdown value={age} /> AGO
            </Badge>
          )}
          {plan.reachedDeadline === true && (
            <Badge severity="warning">PLAN INCOMPLETE</Badge>
          )}
          {integrationBadge(plan)}
        </Cluster>

        {/* The planner draws for its OWN predicted vessel, which is not always
            the active one, so a plan is never presented as this vessel's
            without the guid agreeing. Attributing one craft's burns to another
            would be worse than showing nothing. */}
        {isOtherVessel && (
          <Text>This plan belongs to another vessel, not the active one.</Text>
        )}

        {plan.planExists === false ? (
          // A POSITIVE observation of no plan: the planner rendered and drew
          // none. Distinct from the unobserved case above, and safe to state.
          <Text>No flight plan for this vessel.</Text>
        ) : (
          <Stack>
            {(plan.burns ?? []).map((burn) => (
              <BurnRow
                key={magnitudeOf(burn.index) ?? String(burn.ignitionUt)}
                burn={burn}
                viewUt={viewUt}
                isNext={isNextBurn(burn, plan)}
              />
            ))}
            {(plan.burns ?? []).length === 0 && (
              <Text>A plan with no burns committed yet.</Text>
            )}
          </Stack>
        )}
      </Stack>
    </Section>
  );
}

/**
 * Whether this is the burn the integrator named as next.
 *
 * Both indices have to be READ before they can agree, and the naive version
 * LOOKS CORRECT, which is why this is spelled out at the comparison rather than
 * left to the reader.
 *
 * `magnitudeOf(burn.index) === magnitudeOf(plan.firstFutureBurnIndex)` is what
 * anyone would write. It is wrong for the ABSENT case: with neither index
 * readable both funnel to null, `null === null` holds, and EVERY row is marked
 * next. A payload that lost one field would not go blank and would not error, it
 * would point confidently at the wrong burn on every line, in the widget whose
 * whole purpose is to point at one. The same shape as a `=== undefined` check
 * against a `number | null` field: a comparison that is TRUE when nothing is
 * there. Requiring a real index on both sides means an unreadable one marks
 * nothing, which is the honest answer.
 */
function isNextBurn(
  burn: PrincipiaFlightPlanBurn,
  plan: PrincipiaFlightPlan,
): boolean {
  const index = magnitudeOf(burn.index);
  const next = magnitudeOf(plan.firstFutureBurnIndex);
  return index !== null && next !== null && index === next;
}

/** The active vessel's guid, or null when identity has not arrived. A stale
 *  identity is fine here: which craft is active does not decay the way a
 *  trajectory does, and the alternative is losing the attribution guard
 *  whenever the identity read lags. */
function vesselIdOf(reading: Reading<{ vesselId: string }>): string | null {
  switch (reading.state) {
    case "observed":
      return reading.value.vesselId ?? null;
    case "stale":
    case "reckonable":
      return reading.value.vesselId ?? null;
    default:
      return null;
  }
}

registerAugment({
  id: "principia-flight-plan",
  augments: "maneuver-planner.sections",
  component: FlightPlanSection,
  owner: PRINCIPIA,
});
