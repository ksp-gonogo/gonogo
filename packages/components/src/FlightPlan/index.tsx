import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import type { Value } from "@ksp-gonogo/sitrep-sdk";
import {
  DataLine,
  DataLineGroup,
  EmptyState,
  Panel,
  Section,
  Stack,
} from "@ksp-gonogo/ui-kit";
import read from "./flight-plan.declarations.g";
import {
  missionClock,
  planBadge,
  signed,
  stepName,
  triggerText,
  wholeFigure,
} from "./format";
import type { FlightPlan } from "./plan";
import { useAppliedPlanId, useFlightPlan } from "./planStore";
import { type ScoredPlan, scorePlan } from "./scoring";
import { useCraftKey } from "./section";
import { StepCard } from "./steps";
import { usePlanLive } from "./usePlanLive";

interface FlightPlanConfig {
  /** The saved plan this tile follows. Without one, the tile follows the plan applied to the craft. */
  planId?: string;
}

/** Below this many rows the tile shows its small form: the current step, its progress, and the Δv margin. */
const SMALL_ROWS = 7;

function FlightPlanComponent({
  config,
  h,
}: Readonly<ComponentProps<FlightPlanConfig>>) {
  const applied = useAppliedPlanId(useCraftKey());
  const plan = useFlightPlan(config?.planId ?? applied);
  const { live, progress } = usePlanLive(plan);
  if (!plan) {
    return (
      <Panel
        panelTitle="FLIGHT PLAN"
        sections={
          <Section full>
            <EmptyState>No plan applied</EmptyState>
          </Section>
        }
      />
    );
  }
  const scored = scorePlan(plan, live, progress);
  const badge = planBadge(scored.state);
  const small = (h ?? SMALL_ROWS) < SMALL_ROWS;
  return (
    <Panel
      panelTitle="FLIGHT PLAN"
      panelBadges={[{ id: "state", label: badge.label, tone: badge.tone }]}
      sections={
        small ? (
          <Section fill>
            <SmallPlan plan={plan} scored={scored} />
          </Section>
        ) : (
          <>
            <Section fill>
              <Stack gap="related-compact">
                {scored.steps.map((s, i) => (
                  <StepCard
                    key={s.step.id}
                    index={i}
                    scored={s}
                    current={i === scored.current}
                    live={live}
                  />
                ))}
              </Stack>
            </Section>
            <Section>
              <DvFigures scored={scored} time={live.missionTime} />
            </Section>
          </>
        )
      }
    />
  );
}

function DvFigures({
  scored,
  time,
}: {
  scored: ScoredPlan;
  time: Value<"s"> | undefined;
}) {
  const short = scored.margin?.isNegative() === true;
  return (
    <DataLineGroup>
      <DataLine label="Need">{wholeFigure(scored.need)}</DataLine>
      <DataLine label="Left">{wholeFigure(scored.left)}</DataLine>
      <DataLine label="Margin" tone={short ? "nogo" : undefined}>
        {signed(scored.margin)}
      </DataLine>
      <DataLine label="Reserve">{wholeFigure(scored.reserve)}</DataLine>
      {time === undefined ? null : (
        <DataLine label="At">{missionClock(time)}</DataLine>
      )}
    </DataLineGroup>
  );
}

function SmallPlan({ plan, scored }: { plan: FlightPlan; scored: ScoredPlan }) {
  const cur =
    scored.current === undefined ? undefined : scored.steps[scored.current];
  const failing =
    scored.state.kind === "fails-at" ? scored.state.step : undefined;
  const next = cur?.intents.find((x) => x.status.kind !== "fired");
  const short = scored.margin?.isNegative() === true;
  return (
    <DataLineGroup>
      <DataLine label={cur ? stepName(cur.step) : "Done"}>
        {scored.current === undefined
          ? ""
          : `${scored.current + 1} of ${plan.steps.length}`}
      </DataLine>
      <DataLine label="Δv margin" tone={short ? "nogo" : undefined}>
        {signed(scored.margin)}
      </DataLine>
      {failing !== undefined ? (
        <DataLine label="Short from">{`step ${failing}`}</DataLine>
      ) : next ? (
        <DataLine label="Next">{`AG${next.intent.group} ${triggerText(next.intent.trigger)}`}</DataLine>
      ) : null}
    </DataLineGroup>
  );
}

registerComponent<FlightPlanConfig>({
  id: "flight-plan",
  modes: ["default", "replay", "design"],
  // The scene and career reads pick the craft the plan follows, not a ground control, so the pilot keeps the plan.
  seats: ["mission-control", "pilot"],
  contributionSlots: ["flight-plan.steps"],
  name: "Flight Plan",
  description:
    "Your vessel's flight against the plan applied to it: the current step, its intents, and the Δv the remaining steps need.",
  tags: ["telemetry", "stages"],
  defaultSize: { w: 6, h: 10 },
  minSize: { w: 3, h: 4 },
  component: FlightPlanComponent,
  channels: [
    "vessel.identity",
    "vessel.flight",
    "vessel.control",
    "vessel.orbit",
  ],
  ...read,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { FlightPlanComponent };
