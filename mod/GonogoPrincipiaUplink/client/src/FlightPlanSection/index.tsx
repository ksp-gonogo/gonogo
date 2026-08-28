import type {
  Reading,
  SystemUplinkHealth,
  VantagePlanReply,
} from "@ksp-gonogo/sitrep-sdk";
import {
  registerAugment,
  useStream,
  useTelemetry,
  useVantageTrajectory,
  useViewUt,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Button,
  Cluster,
  Countdown,
  magnitudeOf,
  magnitudeOr,
  NULL_DISPLAY,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type {
  PrincipiaFlightPlan,
  PrincipiaFlightPlanBurn,
  PrincipiaPlan,
} from "../__generated__/contract";
import { PlanIntegrationBlock } from "../PlanIntegration";
import { PRINCIPIA } from "../uplink";
// Side-effect import: hydrates this Topic's units at decode time and augments
// the payload map for the type. Pulled in here rather than left to the entry
// point's import order, because this file is the consumer that would silently
// receive bare numbers without it.
import "../topics";

/** How far ahead the plot reaches: an hour is a manoeuvre's worth of context
 * without asking the integrator for a day. */
const ONE_HOUR_SECONDS = 3600;

/** Points on the returned arc, matching what the streamed arcs carry so a
 * prediction and an observation are drawn at the same fidelity. */
const TRAJECTORY_POINTS = 128;

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

/**
 * The plan's own observation instant wins over the sample's.
 *
 * They agree in production, because the producer publishes the sample AT the
 * instant it observed. But they are different KINDS of fact: the payload field is
 * the producer's statement about when it looked, and the sample UT is transport
 * metadata about when the frame is dated. Anything that re-stamps a sample (a
 * replay, a re-publish) would break the agreement, and then the widget would show
 * the wrong instant while carrying the right one in the same payload. Preferring
 * the producer's own claim means the display cannot disagree with the field it is
 * describing.
 *
 * The sample instant stays as the fallback, for a producer that carried the plan
 * without stating when it saw it.
 */
function planView(reading: Reading<PrincipiaFlightPlan>): PlanView {
  switch (reading.state) {
    /**
     * The three absences are grouped on purpose: this section renders the CONTENTS
     * of a plan, and none of them has anything different to say about a plan there
     * is no content for. Which absence it is belongs to the widget frame around this
     * section, which says it once for the whole widget rather than once per section.
     */
    case "pending":
    case "absent":
    case "unowned":
      return { kind: "unobserved" };
    case "observed":
      return {
        kind: "seen",
        plan: reading.value,
        observedAtUt:
          magnitudeOf(reading.value.observedAtUt) ?? magnitudeOf(reading.atUt),
      };
    case "stale":
    case "reckonable":
      return {
        kind: "seen",
        plan: reading.value,
        observedAtUt:
          magnitudeOf(reading.value.observedAtUt) ??
          magnitudeOf(reading.asOfUt),
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
    // The burn number anchors left and everything else groups right, rather than
    // four values spread evenly across the row: evenly spaced columns drift out of
    // alignment between rows as the values change width, so a reader cannot scan
    // down one quantity. `Row` pins the group instead.
    <Row as="div" data-burn-row="">
      <RowName>{index === null ? NULL_DISPLAY : `#${index + 1}`}</RowName>
      <Cluster justify="end" gap="sm">
        {untilIgnition === null ? (
          <Text>{NULL_DISPLAY}</Text>
        ) : (
          <Countdown value={untilIgnition} clock />
        )}
        {burn.deltaV == null ? (
          <Text>{NULL_DISPLAY}</Text>
        ) : (
          <Unit value={burn.deltaV} decimals={0} />
        )}
        {burn.durationSeconds == null ? (
          <Text>{NULL_DISPLAY}</Text>
        ) : (
          <Countdown value={burn.durationSeconds} />
        )}
        {isNext && <Badge severity="info">NEXT</Badge>}
        {burn.anomalous === true && <Badge severity="warning">ANOM</Badge>}
      </Cluster>
    </Row>
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
/**
 * Says so when the numbers above came out of a Principia build nobody has checked
 * our reading of.
 *
 * Read off the uplink roster rather than a topic of this Uplink's own. Which
 * Principia is installed is the identity of a file on the operator's machine, and
 * the roster is already where an Uplink says whether the thing it depends on is
 * usable. The state below is core's word, not Principia's, so a client that has
 * never heard of Principia renders the same badge from the same field.
 *
 * Nothing at all when the build is vetted, deliberately. A green tick on every
 * panel teaches an operator to stop reading badges, and this section already
 * spends its badge row on things that vary. Silence here means the ordinary case.
 *
 * The wording avoids naming the mechanism. What an operator needs is whether to
 * trust these numbers, not that a descriptor hash failed to match a set.
 */
function buildBadge(roster: SystemUplinkHealth | undefined): ReactNode {
  const entry = roster?.uplinks.find((u) => u.id === PRINCIPIA.id);
  if (entry?.health.state !== "degraded") {
    // Silence covers the ordinary case, the moment before the gate has answered
    // (it does not run until Principia's own startup has mapped its library, and
    // not knowing is not the same as a bad build), and an Uplink reporting
    // unavailable, which is a statement about Principia being absent rather than
    // about the build being wrong.
    return null;
  }
  return <Badge severity="caution">UNVETTED PRINCIPIA BUILD</Badge>;
}

/**
 * Where the craft goes, worked out at THIS command centre from what it has been
 * told, rather than read off the game.
 *
 * <p>Asked for on a press rather than on render. The solve reads an archive and
 * integrates, and a component that ran one every time it re-rendered would do so
 * at animation rate with nothing in the markup admitting it.</p>
 *
 * <p>The seed instant is shown beside the answer, not hidden behind it. A
 * trajectory is only as good as the observation it started from, and at a distant
 * vantage that observation can be an hour old while the curve looks equally
 * confident either way.</p>
 */
/**
 * What a completed solve says, or why there is nothing.
 *
 * <p>Separate from the control that asks for it so it can be rendered from a
 * reply directly. Exercising it through a live dispatch would need a fixture
 * with a delay authority, and the thing worth asserting is not the plumbing but
 * that the SEED INSTANT is shown: a trajectory is only as good as the
 * observation it started from, and at a distant vantage that observation can be
 * an hour old while the curve looks equally confident either way.</p>
 */
export function TrajectoryResult({
  reply,
  viewUt,
}: {
  reply: VantagePlanReply | null;
  viewUt: number | null;
}) {
  if (reply === null) {
    return null;
  }
  if (!reply.solved) {
    // Not an error state. A vantage that has heard nothing is an ordinary
    // condition of a distant mission, and the reason is the useful part.
    return (
      <Text tone="faint" size="sm">
        {reply.refusal ?? "No trajectory from this vantage."}
      </Text>
    );
  }
  return (
    <Row>
      <RowName>COMPUTED FROM STATE OF</RowName>
      {reply.seededAtUt == null || viewUt === null ? (
        <Text>{NULL_DISPLAY}</Text>
      ) : (
        <Text>
          <Countdown value={viewUt - magnitudeOr(reply.seededAtUt, viewUt)} />{" "}
          ago
        </Text>
      )}
    </Row>
  );
}

function VantageTrajectoryRow({ viewUt }: { viewUt: number | null }) {
  const { solve, reply, pending } = useVantageTrajectory();
  const horizon = viewUt === null ? null : viewUt + ONE_HOUR_SECONDS;

  return (
    <Stack>
      <Cluster justify="start" gap="sm">
        <Button
          onClick={() => {
            if (horizon !== null) {
              // Built through `value` rather than cast: the request's numbers
              // carry units on the contract, and a cast would let a seconds
              // figure reach a field declared as an instant without a word
              // from the compiler.
              void solve({
                topic: "vessel.orbit",
                toUt: value("ut", horizon),
                maxPoints: value("count", TRAJECTORY_POINTS),
              });
            }
          }}
          disabled={pending || horizon === null}
        >
          {pending ? "WORKING" : "PLOT NEXT HOUR FROM HERE"}
        </Button>
      </Cluster>

      <TrajectoryResult reply={reply} viewUt={viewUt} />
    </Stack>
  );
}

export function FlightPlanSection() {
  const view = planView(useTelemetry("principia.flightPlan"));
  const identity = useTelemetry("vessel.identity");
  // A second reading, and a different KIND of one. The section above is the
  // planner window as last seen; the integration bounds come from the plugin
  // itself, because the window carries no step limit and the step limit is the
  // remedy for the failure the badges report.
  const integrator = pluginPlan(useTelemetry("principia.plan"));
  const buildHealth = useStream<SystemUplinkHealth>("system.uplinkHealth");
  const viewUt = magnitudeOf(useViewUt());

  if (view.kind === "unobserved") {
    return (
      <Section data-flight-plan-section="">
        <SectionTitle>N-BODY FLIGHT PLAN</SectionTitle>
        <Stack role="status" aria-live="polite">
          {/* Start-justified so the badge shrinks to its content: a `Badge` as a
              direct `Stack` child stretches full width and stops reading as
              one. */}
          <Cluster justify="start">
            <Badge severity="caution">PLAN NOT OBSERVED</Badge>
          </Cluster>
          {/* Deliberately not "no flight plan". The producer can only read the
              plan while the game's own planner window is drawing it, so silence
              here means nobody has looked, which is a different fact and the
              more dangerous one to get wrong: an operator told "no plan" for a
              vessel that has one stops looking. */}
          <Text tone="faint" size="sm">
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
        {/* Wrapping: three badges do not fit a narrow section on one line, and an
            unwrapped cluster clips the last one at the edge rather than dropping
            it to the next. A half-visible INTEGRATION FAILED is the worst of the
            three outcomes. */}
        <Cluster wrap justify="start" gap="sm">
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
          {/* Last in the row because it qualifies the whole section rather than
              one number, and because it is usually absent: a badge that is
              normally missing should not shift the ones that are always there. */}
          {buildBadge(buildHealth)}
        </Cluster>

        {/* The planner draws for its OWN predicted vessel, which is not always
            the active one, so a plan is never presented as this vessel's
            without the guid agreeing. Attributing one craft's burns to another
            would be worse than showing nothing. */}
        {isOtherVessel && (
          <Text>This plan belongs to another vessel, not the active one.</Text>
        )}

        {/* Immediately under the badge that says whether the plan integrated,
            because the commonest cause of a failure there is the step limit and
            the remedy is the control in this block. */}
        <PlanIntegrationBlock plan={integrator} />

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
            <VantageTrajectoryRow viewUt={viewUt} />
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

/** The plugin's own reading of the plan, or null before one has arrived. Only
 *  the integration block reads it, and a stale one is still the right basis for
 *  a bound the operator is about to change. */
function pluginPlan(reading: Reading<PrincipiaPlan>): PrincipiaPlan | null {
  switch (reading.state) {
    case "pending":
    case "absent":
    case "unowned":
      return null;
    default:
      return reading.value;
  }
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
