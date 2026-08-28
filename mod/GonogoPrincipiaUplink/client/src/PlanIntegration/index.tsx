import { useCommand } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  CommandButton,
  Countdown,
  MissionDate,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  RowName,
  Stack,
  Stepper,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type { PrincipiaPlan } from "../__generated__/contract";

/**
 * The step counts the producer's own control offers: eight values, each four
 * times the last.
 *
 * <p>A closed set rather than a range, so the control over it is a stepper. A
 * free numeric field would let an operator send a value the producer's write
 * gate refuses, and a slider would imply the values between mean something.</p>
 */
export const MAX_STEPS_OPTIONS = [
  64, 256, 1024, 4096, 16_384, 65_536, 262_144, 1_048_576,
] as const;

/**
 * The plan's own integration bounds, beside the sentence that says whether the
 * plan integrated.
 *
 * <p><b>Why here and not in the settings panel.</b> These are per-PLAN, not
 * per-session: they travel with the plan slot and they are the remedy for the
 * failure shown two lines above them. The prediction's tolerance and step count
 * look identical, are global, and live in settings; a console that put the four
 * together would explain a plan failure with a prediction setting.</p>
 *
 * <p><b>Why the step count is the one with a control.</b> Running out of steps
 * is the commonest reason a plan stops short of where it was asked to end, and
 * the fix is to raise this number. Putting it anywhere but next to the failure
 * means an operator reads "could not be drawn" and goes looking in a menu.</p>
 */
export function PlanIntegrationBlock({ plan }: { plan: PrincipiaPlan | null }) {
  const integratorCmd = useCommand("principia.plan.integrator");
  usePanelDelay(integratorCmd);
  const [draftSteps, setDraftSteps] = useState<number | null>(null);

  if (plan == null) {
    return null;
  }

  const maxSteps = magnitudeOf(plan.integrator?.maxSteps);
  const chosen = draftSteps ?? maxSteps ?? MAX_STEPS_OPTIONS[0];
  const desired = magnitudeOf(plan.desiredFinalTimeUt);
  const actual = magnitudeOf(plan.actualFinalTimeUt);
  // The pair is the point: a plan that stopped short of where it was asked to
  // end is a plan in trouble, and neither number alone says so.
  const shortfall =
    desired === null || actual === null ? null : desired - actual;

  return (
    <Stack gap="xs" data-plan-integration="">
      <Row as="div">
        <RowName>PLAN ENDS</RowName>
        {plan.desiredFinalTimeUt == null ? (
          <Text>{NULL_DISPLAY}</Text>
        ) : (
          <MissionDate value={plan.desiredFinalTimeUt} />
        )}
      </Row>
      <Row as="div">
        <RowName>REACHED</RowName>
        {plan.actualFinalTimeUt == null ? (
          <Text>{NULL_DISPLAY}</Text>
        ) : (
          <MissionDate value={plan.actualFinalTimeUt} />
        )}
      </Row>
      {shortfall !== null && shortfall > 0 && (
        <Text tone="faint" size="sm">
          {"Stopped "}
          <Countdown value={shortfall} />
          {" short of the requested end."}
        </Text>
      )}

      <Row as="div">
        <RowName>POSITION TOL</RowName>
        {plan.integrator?.lengthToleranceMetres == null ? (
          <Text>{NULL_DISPLAY}</Text>
        ) : (
          <Unit value={plan.integrator.lengthToleranceMetres} decimals={3} />
        )}
      </Row>
      <Row as="div">
        <RowName>SPEED TOL</RowName>
        {plan.integrator?.speedToleranceMetresPerSecond == null ? (
          <Text>{NULL_DISPLAY}</Text>
        ) : (
          <Unit
            value={plan.integrator.speedToleranceMetresPerSecond}
            decimals={3}
          />
        )}
      </Row>

      <Row as="div">
        <RowName>MAX STEPS</RowName>
        <Cluster justify="end" gap="sm" wrap>
          <Stepper
            options={MAX_STEPS_OPTIONS}
            value={chosen}
            onChange={setDraftSteps}
            label="Max integration steps per segment"
            format={(steps) => steps.toLocaleString("en-GB")}
          />
          <CommandButton
            size="sm"
            handle={integratorCmd}
            args={{
              vesselId: plan.vesselId,
              requestId: `integrator-${plan.vesselId ?? "none"}-${chosen}`,
              maxSteps: chosen,
            }}
            commandLabel="Set the flight plan's step limit"
            label="SET"
            confirmLabel="CONFIRM"
            pendingLabel="Setting..."
            disabled={maxSteps !== null && chosen === maxSteps}
            aria-label="Set the flight plan's step limit"
            confirmAriaLabel="Confirm setting the flight plan's step limit"
          />
        </Cluster>
      </Row>
      {/* The remedy, said where the failure is read rather than in a manual.
          Raising it costs integration time and nothing else. */}
      <Text tone="faint" size="sm">
        Raise this when the plan stops short of its requested end.
      </Text>
    </Stack>
  );
}
