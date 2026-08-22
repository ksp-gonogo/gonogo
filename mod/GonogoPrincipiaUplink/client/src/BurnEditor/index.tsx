import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  registerAugment,
  useCommand,
  useTelemetry,
  useViewUt,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  CommandButton,
  Countdown,
  FieldLabel,
  Input,
  MissionDate,
  MissionDateField,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  RowName,
  Section,
  SectionTitle,
  SelectableRow,
  Stack,
  Text,
  ToggleButton,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type { ComponentProps } from "react";
import { useState } from "react";
import type {
  PrincipiaPlan,
  PrincipiaPlannedBurn,
} from "../__generated__/contract";
import { PrincipiaBurnProfile } from "../__generated__/contract";
import { plottingFrameLabel } from "../plottingFrame";
import { PRINCIPIA } from "../uplink";
import "../topics";

/**
 * The tuning loop: pick a burn, nudge its instant and its Dv, watch what the
 * plan does about it.
 *
 * <para><b>Why the console has to offer this at all.</b> Principia's flight plan
 * is the mod's actual new mechanic, and it is a mechanic because it is TUNED: a
 * transfer is found by moving one burn a few minutes and a few metres per second
 * at a time and reading what happens to two periapses. A console that mirrors
 * the plan and cannot change it turns the operator back to the game window for
 * the only part of the plan that is interactive.</para>
 *
 * <para><b>What is deliberately not here.</b> The resulting arc. Seeing the
 * curve before committing to the real burn wants an integrated trajectory, and
 * the only thing that can draw one is the propagation seam, which currently has
 * no production implementer. The instant-impulse profile IS here, because it is
 * a property of the burn rather than of the drawing, and Principia will draw its
 * arc in the game's own map.</para>
 *
 * <para>Every control is disabled until the write surface says it is armed, and
 * the reason it is not travels with the plan rather than being discovered by
 * trying.</para>
 */
type PlanView =
  | { kind: "none"; reason: string }
  | { kind: "plan"; plan: PrincipiaPlan };

/**
 * A plan the console has never been told about and a vessel with no plan are
 * different facts, and so is a plan we last heard about hours ago.
 *
 * A stale plan is still shown, because an operator who can see how old it is can
 * act on it. What is refused is EDITING one: the burn index and the burn count
 * both come off a reading, and a write bounded against a reading from an hour
 * ago is the exact mistake the producer's own protocol is built to prevent.
 */
function planView(reading: Reading<PrincipiaPlan>): PlanView {
  switch (reading.state) {
    case "pending":
      return { kind: "none", reason: "Waiting for Principia." };
    case "absent":
      return {
        kind: "none",
        reason:
          "No plan reading. Principia is not running, or the console has no vessel.",
      };
    default:
      return { kind: "plan", plan: reading.value };
  }
}

/** What the operator has changed but not yet sent. */
interface Draft {
  burnIndex: number;
  ignitionUt: number;
  tangent: number;
  normal: number;
  binormal: number;
  inertiallyFixed: boolean;
  instantImpulse: boolean;
}

function draftOf(burn: PrincipiaPlannedBurn): Draft {
  return {
    burnIndex: magnitudeOf(burn.index) ?? 0,
    ignitionUt: magnitudeOf(burn.ignitionUt) ?? 0,
    tangent: magnitudeOf(burn.deltaVTangent) ?? 0,
    normal: magnitudeOf(burn.deltaVNormal) ?? 0,
    binormal: magnitudeOf(burn.deltaVBinormal) ?? 0,
    inertiallyFixed: burn.inertiallyFixed === true,
    instantImpulse: false,
  };
}

/**
 * The Dv triple, one axis per row.
 *
 * <para>The producer's own axis names are kept, with one exception: its tangent
 * IS stock's prograde and saying so costs nothing. Normal and binormal are NOT
 * glossed, because the Frenet normal is the in-plane one and stock's normal is
 * the out-of-plane one, so translating them would be a physics error wearing a
 * friendlier label. Getting the vocabulary right and the axis wrong is the
 * inversion worth avoiding.</para>
 */
function DeltaVRow({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <Cluster gap="sm" justify="start">
      <FieldLabel htmlFor={id}>
        {label}
        {hint ? ` / ${hint}` : ""}
      </FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={0.1}
        style={{ width: "8rem" }}
        disabled={disabled}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      <Text tone="faint" size="sm">
        m/s
      </Text>
    </Cluster>
  );
}

/**
 * One line of the planned profile.
 *
 * `<Unit>` renders it, always: the value arrives from the wire carrying its own
 * unit, and a hand-written suffix beside a number is how a kilonewton ends up
 * labelled as a tonne.
 */
function ProfileRow({
  name,
  value,
  decimals,
}: {
  name: string;
  // Whatever `<Unit>` accepts, so a field that changes unit on the wire keeps
  // type-checking here instead of needing this signature widened by hand.
  value: ComponentProps<typeof Unit>["value"];
  decimals: number;
}) {
  return (
    <Row as="div">
      <RowName>{name}</RowName>
      {value == null ? (
        <Text>{NULL_DISPLAY}</Text>
      ) : (
        <Unit value={value} decimals={decimals} />
      )}
    </Row>
  );
}

/** The magnitude of a triple, so the row of three has a headline. */
export function deltaVMagnitude(draft: Draft): number {
  return Math.sqrt(
    draft.tangent * draft.tangent +
      draft.normal * draft.normal +
      draft.binormal * draft.binormal,
  );
}

export function BurnEditor() {
  const view = planView(useTelemetry("principia.plan"));
  const viewUt = magnitudeOf(useViewUt());

  const armCmd = useCommand("principia.plan.arm");
  const replaceCmd = useCommand("principia.plan.burn.replace");
  const insertCmd = useCommand("principia.plan.burn.insert");
  const removeCmd = useCommand("principia.plan.burn.remove");
  usePanelDelay(armCmd);
  usePanelDelay(replaceCmd);
  usePanelDelay(insertCmd);
  usePanelDelay(removeCmd);

  const [draft, setDraft] = useState<Draft | null>(null);

  if (view.kind === "none") {
    return (
      <Section data-burn-editor="">
        <SectionTitle>BURN EDITOR</SectionTitle>
        <Stack role="status" aria-live="polite">
          <Cluster justify="start">
            <Badge severity="caution">NO PLAN READING</Badge>
          </Cluster>
          <Text tone="faint" size="sm">
            {view.reason}
          </Text>
        </Stack>
      </Section>
    );
  }

  const { plan } = view;
  const surface = plan.writeSurface;
  const armed = surface?.armed === true;
  const available = surface?.available === true;
  const burns = plan.burns ?? [];
  const vesselId = plan.vesselId ?? undefined;

  const selected =
    draft === null
      ? undefined
      : burns.find((burn) => magnitudeOf(burn.index) === draft.burnIndex);
  const frozen = !armed || selected?.frameEditable !== true;

  return (
    <Section data-burn-editor="">
      <SectionTitle>BURN EDITOR</SectionTitle>
      <Stack>
        {/* The plan's identity first. Every number below belongs to whichever
            slot this names, and an operator reading a plan they are not flying
            is the failure mode ten parallel plans creates. */}
        <Cluster wrap justify="start" gap="sm">
          <Badge severity="info">
            {`PLAN ${(magnitudeOf(plan.selectedPlan) ?? -1) + 1} OF ${
              magnitudeOf(plan.planCount) ?? 0
            }`}
          </Badge>
          {plan.planExists === false && (
            <Badge severity="caution">NO PLAN ON THIS VESSEL</Badge>
          )}
          {plan.optimisationRunning === true && (
            <Badge severity="warning">OPTIMISING</Badge>
          )}
          {armed ? (
            <Badge severity="nominal">ARMED</Badge>
          ) : (
            <Badge severity="caution">NOT ARMED</Badge>
          )}
        </Cluster>

        {/* Arming is a real write of Principia's own burn back into the plan, so
            it confirms rather than firing on the first press. */}
        <Cluster gap="sm" wrap justify="start">
          <CommandButton
            size="sm"
            tone="go"
            handle={armCmd}
            args={{ vesselId, requestId: `arm-${vesselId ?? "none"}` }}
            commandLabel="Arm the flight-plan write surface"
            label="ARM WRITES"
            confirmLabel="CONFIRM ARM"
            confirmTone="nogo"
            pendingLabel="Arming..."
            disabled={!available}
            aria-label="Arm the flight-plan write surface"
            confirmAriaLabel="Confirm arming the flight-plan write surface"
          />
          {surface?.reason && (
            <Text tone="faint" size="sm">
              {surface.reason}
            </Text>
          )}
        </Cluster>

        <Stack gap="xs">
          <Text tone="faint" size="sm">
            {`PLAN ENDS ${plan.desiredFinalTimeUt == null ? NULL_DISPLAY : ""}`}
            {plan.desiredFinalTimeUt != null && (
              <MissionDate value={plan.desiredFinalTimeUt} />
            )}
          </Text>
          {burns.length === 0 && (
            <Text>
              This plan has no burns. Add the first one in Principia's own
              planner: the console copies an existing burn rather than composing
              one, because a composed burn is a bet on a struct layout.
            </Text>
          )}
          {burns.map((burn) => {
            const index = magnitudeOf(burn.index);
            const ignition = magnitudeOf(burn.ignitionUt);
            return (
              <SelectableRow
                key={index ?? String(burn.ignitionUt)}
                selected={draft?.burnIndex === index}
                onClick={() => setDraft(draftOf(burn))}
                aria-label={`Burn ${(index ?? 0) + 1}`}
              >
                <RowName>
                  {index === null ? NULL_DISPLAY : `#${index + 1}`}
                </RowName>
                <Cluster justify="end" gap="sm">
                  {/* To IGNITION, never to a node. Principia anchors a burn to
                      its start and honouring that is the whole point. */}
                  {ignition === null || viewUt === null ? (
                    <Text>{NULL_DISPLAY}</Text>
                  ) : (
                    <Countdown value={ignition - viewUt} clock />
                  )}
                  {burn.deltaV == null ? (
                    <Text>{NULL_DISPLAY}</Text>
                  ) : (
                    <Unit value={burn.deltaV} decimals={1} />
                  )}
                  {burn.executing === true && (
                    <Badge severity="critical">BURNING</Badge>
                  )}
                  {burn.frameEditable === false && (
                    <Badge severity="warning">FRAME LOCKED</Badge>
                  )}
                  {burn.anomalous === true && (
                    <Badge severity="warning">ANOM</Badge>
                  )}
                </Cluster>
              </SelectableRow>
            );
          })}
        </Stack>

        {draft !== null && selected && (
          <Stack gap="md" data-burn-editor-form="">
            <Cluster wrap justify="start" gap="sm">
              <Badge severity="info">{`BURN ${draft.burnIndex + 1}`}</Badge>
              {/* The burn's own manoeuvring frame, which is routinely NOT the
                  plotting frame, and the only reliable warning that it differs
                  is on this line. */}
              <Text tone="faint" size="sm">
                {plottingFrameLabel(magnitudeOf(selected.frameType))}
              </Text>
              {selected.frameEditable === false && (
                <Badge severity="warning">
                  THIS FRAME CANNOT BE WRITTEN BACK
                </Badge>
              )}
            </Cluster>

            {/* The planned profile. An integrated burn's arc depends on the
                propulsion, so a stage or engine change moves the trajectory and
                these are part of the plan rather than trivia. */}
            <Stack gap="xs">
              <ProfileRow
                name="THRUST"
                value={selected.thrustKilonewtons}
                decimals={1}
              />
              <ProfileRow
                name="MASS FLOW"
                value={selected.massFlowKilogramsPerSecond}
                decimals={2}
              />
              <ProfileRow
                name="ISP"
                value={selected.specificImpulseSeconds}
                decimals={0}
              />
              <ProfileRow
                name="MASS AT IGNITION"
                value={selected.initialMassTons}
                decimals={2}
              />
              <ProfileRow
                name="MASS AT CUTOFF"
                value={selected.finalMassTons}
                decimals={2}
              />
            </Stack>

            <Stack gap="xs">
              <SectionTitle>IGNITION</SectionTitle>
              <MissionDateField
                label="Ignition"
                value={draft.ignitionUt}
                disabled={frozen}
                onChange={(ut) => setDraft({ ...draft, ignitionUt: ut })}
              />
            </Stack>

            <Stack gap="xs">
              <SectionTitle>DELTA-V</SectionTitle>
              <DeltaVRow
                id="burn-dv-tangent"
                label="TANGENT"
                hint="prograde"
                value={draft.tangent}
                disabled={frozen}
                onChange={(next) => setDraft({ ...draft, tangent: next })}
              />
              <DeltaVRow
                id="burn-dv-normal"
                label="NORMAL"
                value={draft.normal}
                disabled={frozen}
                onChange={(next) => setDraft({ ...draft, normal: next })}
              />
              <DeltaVRow
                id="burn-dv-binormal"
                label="BINORMAL"
                value={draft.binormal}
                disabled={frozen}
                onChange={(next) => setDraft({ ...draft, binormal: next })}
              />
              <Row as="div">
                <RowName>MAGNITUDE</RowName>
                <Text>{`${deltaVMagnitude(draft).toFixed(1)} m/s`}</Text>
              </Row>
            </Stack>

            {/* A direction locked to the stars behaves differently from one that
                rotates with the orbit, and that difference is the whole point of
                the setting, so it is a named pair rather than a checkbox. */}
            <Cluster gap="sm" wrap justify="start">
              <ToggleButton
                size="sm"
                active={draft.inertiallyFixed}
                disabled={frozen}
                onClick={() =>
                  setDraft({
                    ...draft,
                    inertiallyFixed: !draft.inertiallyFixed,
                  })
                }
              >
                {draft.inertiallyFixed ? "INERTIALLY FIXED" : "FRAME-RELATIVE"}
              </ToggleButton>
              <ToggleButton
                size="sm"
                active={draft.instantImpulse}
                disabled={frozen}
                onClick={() =>
                  setDraft({ ...draft, instantImpulse: !draft.instantImpulse })
                }
              >
                INSTANT IMPULSE
              </ToggleButton>
            </Cluster>

            <Cluster gap="sm" wrap justify="start">
              <CommandButton
                size="sm"
                tone="go"
                handle={replaceCmd}
                args={{
                  vesselId,
                  requestId: `replace-${draft.burnIndex}-${draft.ignitionUt}-${draft.tangent}-${draft.normal}-${draft.binormal}-${draft.inertiallyFixed}-${draft.instantImpulse}`,
                  burnIndex: draft.burnIndex,
                  ignitionUt: draft.ignitionUt,
                  deltaVTangent: draft.tangent,
                  deltaVNormal: draft.normal,
                  deltaVBinormal: draft.binormal,
                  inertiallyFixed: draft.inertiallyFixed,
                  profile: draft.instantImpulse
                    ? PrincipiaBurnProfile.InstantImpulse
                    : PrincipiaBurnProfile.Unchanged,
                }}
                commandLabel={`Apply burn ${draft.burnIndex + 1}`}
                label="APPLY"
                confirmLabel="CONFIRM APPLY"
                confirmTone="nogo"
                pendingLabel="Applying..."
                disabled={frozen}
                aria-label="Apply the edited burn"
                confirmAriaLabel="Confirm applying the edited burn"
              />
              <CommandButton
                size="sm"
                handle={insertCmd}
                args={{
                  vesselId,
                  requestId: `insert-${draft.burnIndex}-${draft.ignitionUt}`,
                  burnIndex: draft.burnIndex,
                  ignitionUt: draft.ignitionUt,
                  deltaVTangent: draft.tangent,
                  deltaVNormal: draft.normal,
                  deltaVBinormal: draft.binormal,
                }}
                commandLabel="Add a burn like this one"
                label="ADD LIKE THIS"
                confirmLabel="CONFIRM ADD"
                confirmTone="nogo"
                pendingLabel="Adding..."
                disabled={frozen}
                aria-label="Add a burn copied from this one"
                confirmAriaLabel="Confirm adding a burn copied from this one"
              />
              <CommandButton
                size="sm"
                handle={removeCmd}
                args={{
                  vesselId,
                  requestId: `remove-${draft.burnIndex}`,
                  burnIndex: draft.burnIndex,
                }}
                commandLabel={`Remove burn ${draft.burnIndex + 1}`}
                label="REMOVE"
                confirmLabel="CONFIRM REMOVE"
                confirmTone="nogo"
                pendingLabel="Removing..."
                disabled={!armed}
                aria-label="Remove this burn from the plan"
                confirmAriaLabel="Confirm removing this burn from the plan"
              />
            </Cluster>

            {/* The values on screen came from a reading; APPLY sends them all,
                including the ones nobody touched, so the operator is told which
                reading they are editing rather than assuming it is now. */}
            <Text tone="faint" size="sm">
              Editing the plan as read at{" "}
              {plan.sampledAtUt == null ? (
                NULL_DISPLAY
              ) : (
                <MissionDate value={plan.sampledAtUt} />
              )}
              .
            </Text>
          </Stack>
        )}
      </Stack>
    </Section>
  );
}

registerAugment({
  id: "principia-burn-editor",
  augments: "maneuver-planner.sections",
  component: BurnEditor,
  owner: PRINCIPIA,
});
