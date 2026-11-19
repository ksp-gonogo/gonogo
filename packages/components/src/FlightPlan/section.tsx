import {
  registerAugment,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useViewClockOptional } from "@ksp-gonogo/sitrep-client";
import {
  type ModeSectionProps,
  Situation,
  stillTrue,
  type Tone,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Button,
  DataLine,
  DataLineGroup,
  EmptyState,
  Grid,
  Inline,
  Row,
  Stack,
  TextField,
  ToggleButton,
  useModal,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import {
  planBadge,
  signed,
  stepBadge,
  stepName,
  stepTarget,
  wholeFigure,
} from "./format";
import type { FlightPlan } from "./plan";
import { totalNeed } from "./plan";
import "./coreSteps";
import { PlanEditor } from "./editor";
import {
  applyPlan,
  carryEditorPlan,
  EDITOR,
  savePlan,
  useAppliedPlanId,
  useFlightPlan,
  useFlightPlans,
} from "./planStore";
import { type PlanLive, type ScoredPlan, scorePlan } from "./scoring";
import { StepCard } from "./steps";
import { usePlanLive } from "./usePlanLive";

/** The craft a plan is applied to: the craft in the editor, or the active vessel in flight. */
export function useCraftKey(): string | undefined {
  const { scene } = useGameContext();
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  if (scene === "Editor") return EDITOR;
  return identity?.vesselId;
}

/*
 * Interim: the editor's craft has no id the vessel keeps, so a plan applied in
 * the editor is moved to the craft launched from it, the first vessel in
 * flight that is on the pad or left it after the plan was applied. The launch
 * time covers a craft whose pad frame never reached this screen, such as a
 * script that stages the moment the craft is loaded. Once the plan is copied
 * into the save this goes.
 */
function useEditorPlanCarry(): void {
  const { scene } = useGameContext();
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  const vesselId = identity?.vesselId ?? undefined;
  const onPad = identity?.situation === Situation.PreLaunch;
  const launchUt =
    identity?.launchUt == null ? undefined : Number(identity.launchUt);
  useEffect(() => {
    if (scene === "Flight" && vesselId) {
      carryEditorPlan({ vesselId, onPad, launchUt });
    }
  }, [scene, onPad, vesselId, launchUt]);
}

/** The id of the plan applied to the craft, carrying a plan applied in the editor onto the craft launched from it. */
export function useCraftPlanId(): string | undefined {
  useEditorPlanCarry();
  return useAppliedPlanId(useCraftKey());
}

/** The game time to stamp a plan applied now with, so it can pass to a craft launched after it. */
function useApplyUt(): () => number | undefined {
  const clock = useViewClockOptional();
  return () => clock?.confirmedEdgeUt();
}

/** The plan applied to the craft, scored against it: before flight from the Δv it has, in flight against the live flight. */
export function useAppliedPlan(): {
  plan: FlightPlan | undefined;
  scored: ScoredPlan | undefined;
  planning: boolean;
  live: PlanLive;
} {
  const { scene } = useGameContext();
  const planning = scene === "Editor";
  const plan = useFlightPlan(useCraftPlanId());
  const { live, progress } = usePlanLive(plan);
  const scored = plan
    ? scorePlan(plan, live, progress, undefined, planning)
    : undefined;
  return { plan, scored, planning, live };
}

/** Reports the plan's state and margin for the section's heading. */
function useReportStatus(
  scored: ScoredPlan | undefined,
  report: ModeSectionProps["reportStatus"] | undefined,
): void {
  const badge = scored ? planBadge(scored.state) : undefined;
  const label = badge?.label;
  const tone: Tone | undefined = badge?.tone;
  const detail =
    scored?.margin === undefined
      ? undefined
      : `margin ${signed(scored.margin)}`;
  useEffect(() => {
    report?.(
      label !== undefined && tone !== undefined
        ? { label, tone, detail }
        : undefined,
    );
  }, [label, tone, detail, report]);
}

/** A plan built from the four core steps, to start from. */
function starterPlan(taken: readonly FlightPlan[]): FlightPlan {
  const ids = new Set(taken.map((p) => p.id));
  let n = taken.length + 1;
  while (ids.has(`plan-${n}`)) n += 1;
  return {
    id: `plan-${n}`,
    name: "New plan",
    reserve: 0.1,
    steps: [
      { id: "s1", kind: "launch", inputs: { heading: 90 }, intents: [] },
      {
        id: "s2",
        kind: "reach-orbit",
        inputs: { body: "Kerbin", periapsis: 80_000 },
        needsDv: 3_400,
        intents: [],
      },
    ],
  };
}

/**
 * The Flight Plan section of a mode's pane: the plan applied to the craft, one
 * row per step with its state, and the controls that save, change and apply
 * plans.
 */
function FlightPlanSection({ reportStatus }: Partial<ModeSectionProps> = {}) {
  const craft = useCraftKey();
  const plans = useFlightPlans();
  const { plan, scored, planning, live } = useAppliedPlan();
  const applyUt = useApplyUt();
  useReportStatus(scored, reportStatus);
  const { open, close } = useModal();
  const openApply = () => {
    const id = open(<ApplySheet craft={craft} onDone={() => close(id)} />, {
      title: "Apply plan",
    });
  };
  if (!plan || !scored) {
    return (
      <Stack gap="related-compact">
        <EmptyState>No plan applied</EmptyState>
        <Inline gap="related-compact">
          <Button
            variant="primary"
            onClick={() => {
              const p = starterPlan(plans);
              savePlan(p);
              if (craft) applyPlan(craft, p.id, applyUt());
            }}
          >
            New plan
          </Button>
          <Button onClick={openApply}>Apply plan</Button>
        </Inline>
      </Stack>
    );
  }
  const openSave = () => {
    const id = open(<SaveSheet plan={plan} onDone={() => close(id)} />, {
      title: "Save plan",
    });
  };
  return (
    <Stack gap="related-compact">
      {planning ? (
        <PlanEditor plan={plan} scored={scored} live={live} />
      ) : (
        <Stack gap="related-dense">
          {scored.steps.map((s, i) => {
            const badge =
              i === scored.current
                ? {
                    label: s.flagged ? "Off plan" : "On plan",
                    tone: (s.flagged ? "caution" : "go") as Tone,
                  }
                : stepBadge(s.status);
            return (
              <Grid
                key={s.step.id}
                cols="auto auto 1fr auto auto"
                gap="related-compact"
                align="center"
                data-current={i === scored.current || undefined}
                data-failed={
                  s.status.kind === "short" ||
                  s.status.kind === "likely-to-fail" ||
                  undefined
                }
              >
                <span>{i + 1}</span>
                <span>{stepName(s.step)}</span>
                <span>{stepTarget(s.step)}</span>
                <span>
                  {s.status.kind === "done" ? undefined : badge?.figure}
                </span>
                {badge ? (
                  <Badge size="sm" tone={badge.tone}>
                    {badge.label}
                  </Badge>
                ) : (
                  <span />
                )}
              </Grid>
            );
          })}
        </Stack>
      )}
      <Inline gap="related-compact">
        <Button onClick={openSave}>Save plan</Button>
        <Button onClick={openApply}>Apply plan</Button>
      </Inline>
    </Stack>
  );
}

/** Saves the plan as it stands: its steps, their intents and the reserve. */
function SaveSheet({ plan, onDone }: { plan: FlightPlan; onDone: () => void }) {
  const [name, setName] = useState(plan.name);
  const [everySave, setEverySave] = useState(true);
  const { live, progress } = usePlanLive(plan);
  const scored = scorePlan(plan, live, progress, undefined, true);
  return (
    <Stack gap="related">
      <TextField label="Name" value={name} onChange={setName} />
      <Inline gap="related-dense">
        <ToggleButton pressed={everySave} onClick={() => setEverySave(true)}>
          Every save
        </ToggleButton>
        <ToggleButton pressed={!everySave} onClick={() => setEverySave(false)}>
          This save
        </ToggleButton>
      </Inline>
      <Stack gap="related-dense">
        {scored.steps.map((s, i) => (
          <StepCard
            key={s.step.id}
            index={i}
            scored={{ ...s, status: { kind: "unscored" } }}
            current={false}
            live={live}
            planning
          />
        ))}
      </Stack>
      <DataLineGroup>
        <DataLine label="Reserve">
          {writeQuantity(value("%", plan.reserve * 100), { decimals: 0 })}
        </DataLine>
      </DataLineGroup>
      <Inline gap="related-compact">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            savePlan({ ...plan, name: name.trim() || plan.name });
            onDone();
          }}
        >
          Save
        </Button>
      </Inline>
    </Stack>
  );
}

/** Picks a saved plan and re-scores it against this craft, the first failing step expanded. */
function ApplySheet({
  craft,
  onDone,
}: {
  craft: string | undefined;
  onDone: () => void;
}) {
  const plans = useFlightPlans();
  const applyUt = useApplyUt();
  const [chosen, setChosen] = useState<string | undefined>(plans[0]?.id);
  const plan = plans.find((p) => p.id === chosen);
  const { live, progress } = usePlanLive(plan);
  const scored = plan
    ? scorePlan(plan, live, progress, undefined, true)
    : undefined;
  const firstFailing = scored?.steps.findIndex(
    (s) => s.status.kind === "short" || s.status.kind === "likely-to-fail",
  );
  if (plans.length === 0) return <EmptyState>No saved plans</EmptyState>;
  return (
    <Stack gap="related">
      <Stack gap="related-dense">
        {plans.map((p) => (
          <Row
            key={p.id}
            interactive
            selected={p.id === chosen}
            onClick={() => setChosen(p.id)}
          >
            {p.name}
          </Row>
        ))}
      </Stack>
      {plan && scored ? (
        <>
          <Stack gap="related-dense">
            {scored.steps.map((s, i) => (
              <StepCard
                key={s.step.id}
                index={i}
                scored={s}
                current={i === firstFailing}
                live={live}
              />
            ))}
          </Stack>
          <DataLineGroup>
            <DataLine label="Needs">
              {wholeFigure(value("m/s", totalNeed(plan)))}
            </DataLine>
            <DataLine label="Has">{wholeFigure(live.dvLeft)}</DataLine>
          </DataLineGroup>
        </>
      ) : null}
      <Inline gap="related-compact">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!plan || craft === undefined}
          disabledReason={!plan ? "Choose a plan" : "No craft to apply it to"}
          onClick={() => {
            if (plan && craft) applyPlan(craft, plan.id, applyUt());
            onDone();
          }}
        >
          Apply
        </Button>
      </Inline>
    </Stack>
  );
}

// In flight the Flight Plan widget shows the plan, so the section is design mode's alone.
registerAugment({
  id: "flight-plan.pane.design",
  augments: "mode-sections.design",
  label: "Flight Plan",
  component: FlightPlanSection,
});

export { FlightPlanSection };
