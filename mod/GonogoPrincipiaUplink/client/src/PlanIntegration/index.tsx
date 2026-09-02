import { useCommand, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  CommandButton,
  Countdown,
  MissionDate,
  MissionDateField,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  RowName,
  SectionTitle,
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
 * <p><b>Why the two remedies are one block.</b> A plan that stops short of
 * where it was asked to end has exactly two answers: a bigger step budget, or a
 * nearer end. Running out of steps is the commoner of the two, and moving the
 * end is the cheaper write, recomputing only the final coast. Put either
 * anywhere but next to the shortfall and an operator reads "could not be drawn"
 * and goes looking in a menu; put them in different panels and they will find
 * one of the two.</p>
 *
 * <p><b>What shortening the plan costs, and why it is said here.</b> Moving the
 * end earlier makes every burn beyond it vanish, and a burn that disappeared
 * reads exactly like a burn that was deleted. The count is on screen before the
 * press, from the burn list this block already holds.</p>
 *
 * <p>Both controls freeze on the whole of the mod's plan-write gate, not on the
 * arm alone: every plan write is persisted into the player's save and
 * re-integrates on the game's own thread, so it takes an arm first, and a write
 * made while Principia is optimising is reverted without being reported.
 * Offering either anyway would spend a delay round trip to be told what the
 * reading already carries, and `frozenBecause` says which it is on screen.</p>
 */
/**
 * Why neither remedy can be dispatched, or null when both can.
 *
 * <p>The arm sentence is the MOD's, passed through rather than reworded: it
 * names the guard and it is the same sentence every other Principia write
 * surface shows for the same state. The optimiser's is ours, because the write
 * surface publishes the flag and not a sentence about it.</p>
 */
function frozenBecause(plan: PrincipiaPlan): string | null {
  if (plan.optimisationRunning === true) {
    return "Principia is optimising this plan. A write made now is reverted without being reported: the optimiser publishes a new candidate plan and Principia's own planner swaps it over the live one every frame.";
  }
  if (plan.writeSurface?.armed !== true) {
    return (
      plan.writeSurface?.reason ??
      "The flight-plan write surface is not armed, so neither of these can be sent."
    );
  }
  return null;
}

export function PlanIntegrationBlock({ plan }: { plan: PrincipiaPlan | null }) {
  const integratorCmd = useCommand("principia.plan.integrator");
  const horizonCmd = useCommand("principia.plan.horizon");
  usePanelDelay(integratorCmd);
  usePanelDelay(horizonCmd);
  const [draftSteps, setDraftSteps] = useState<number | null>(null);
  const [draftEndUt, setDraftEndUt] = useState<number | null>(null);

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

  /*
   * Both controls here go through the mod's plan-write gate, which checks the
   * arm AND the optimiser: a write made while Principia is optimising is
   * reverted without being reported, because the optimiser publishes a fresh
   * candidate plan and the producer's own planner swaps it over the live one
   * every frame. So the two freeze together, and the reason is on screen rather
   * than discovered a light time later.
   */
  const frozenReason = frozenBecause(plan);
  const frozen = frozenReason !== null;
  /*
   * Seeded from the plan's own end, so an operator who nudges it is moving the
   * instant the plan actually holds rather than one this block invented. Null
   * only while the end has not been read, which is also when there is nothing to
   * move it relative to.
   */
  const endUt = draftEndUt ?? desired;
  /*
   * Every burn Principia would drop if the plan ended here. Its own doc names
   * this as the trap: the burns go, the write reports success, and a burn that
   * vanished reads as a burn that was deleted.
   */
  const strandedBurns =
    endUt === null
      ? 0
      : (plan.burns ?? []).filter((burn) => {
          const ignition = magnitudeOf(burn.ignitionUt);
          return ignition !== null && ignition >= endUt;
        }).length;
  const startUt = magnitudeOf(plan.initialTimeUt);
  const endsBeforeStart =
    endUt !== null && startUt !== null && endUt <= startUt;

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

      {/* The second remedy, beside the first. Moving the end is the cheapest
          mutator on the plan: it recomputes only the final coast. */}
      {endUt !== null && (
        <Stack gap="xs" data-plan-horizon="">
          {/* A heading, because five bare date boxes under a row of instants say
              nothing about which instant they edit. The rows above are what the
              plan HOLDS; this is the one that can be changed. */}
          <SectionTitle>PLAN END</SectionTitle>
          <MissionDateField
            label="Plan end"
            value={endUt}
            disabled={frozen}
            onChange={setDraftEndUt}
          />
          {/* A count as its own reading rather than a number inside a
              sentence: this is the fact that decides whether to move the end at
              all, and it belongs where the eye scans for a quantity. */}
          <Row as="div">
            <RowName>BURNS DROPPED</RowName>
            <Unit value={value("count", strandedBurns)} decimals={0} />
          </Row>
          <Cluster justify="end" gap="sm" wrap>
            <CommandButton
              size="sm"
              handle={horizonCmd}
              args={{
                vesselId: plan.vesselId,
                requestId: `horizon-${plan.vesselId ?? "none"}-${endUt}`,
                desiredFinalTimeUt: endUt,
              }}
              commandLabel="Move the flight plan's end instant"
              label="SET END"
              confirmLabel="CONFIRM"
              pendingLabel="Setting..."
              disabled={frozen || endUt === desired || endsBeforeStart}
              aria-label="Move the flight plan's end instant"
              confirmAriaLabel="Confirm moving the flight plan's end instant"
            />
          </Cluster>
          {strandedBurns > 0 && (
            <Text tone="warn" size="sm">
              Every burn igniting at or after this end is removed. Principia
              reports the write as a success and the burns are simply gone.
            </Text>
          )}
          {endsBeforeStart && (
            <Text tone="warn" size="sm">
              A plan cannot end at or before it starts.
            </Text>
          )}
        </Stack>
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
            disabled={frozen}
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
            disabled={frozen || (maxSteps !== null && chosen === maxSteps)}
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
      {/* Once, under both, because it is one gate and repeating it beside each
          control would say the same thing twice. */}
      {frozenReason !== null && (
        <Text tone="faint" size="sm">
          {frozenReason}
        </Text>
      )}
    </Stack>
  );
}
