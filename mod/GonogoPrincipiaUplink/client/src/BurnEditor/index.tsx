import {
  registerAugment,
  useCommand,
  useTelemetry,
  useViewUt,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  BinormalIcon,
  Cluster,
  CommandButton,
  Countdown,
  FieldLabel,
  FrenetNormalIcon,
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
  TangentIcon,
  Text,
  ToggleButton,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type { ComponentProps } from "react";
import { useState } from "react";
import type {
  PrincipiaPlannedBurn,
  PrincipiaPlanWriteReceipt,
} from "../__generated__/contract";
import { PrincipiaBurnProfile } from "../__generated__/contract";
import { commandWindow } from "../commandWindow";
import { planView } from "../planReading";
import {
  nothingWasWritten,
  planWriteReceipt,
  planWriteRefusalLine,
} from "../planWrite";
import { plottingFrameLabel } from "../plottingFrame";
import { PRINCIPIA } from "../uplink";
import "../topics";

/**
 * When an edit to a burn stops being able to reach it: `commandWindow`, whose
 * doc carries the reasoning. Measured against the DRAFT's ignition rather than
 * the burn's, because the draft's is the instant that gets written.
 */
const editWindow = commandWindow;

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
  icon: Icon,
  label,
  hint,
  value,
  disabled,
  unitKnown = true,
  onChange,
}: {
  id: string;
  /**
   * The navball glyph for this axis. Decorative on purpose: it carries no
   * `label`, so it is hidden from assistive technology and the row is announced
   * once, by the text beside it, rather than twice.
   */
  icon: typeof TangentIcon;
  label: string;
  hint?: string;
  value: number;
  disabled: boolean;
  /**
   * False when the slot's unit depends on a coordinate system that does not put
   * a velocity in it. The symbol goes rather than being replaced by a guess: two
   * of the three slots are angles under the spherical systems and one is a
   * speed, so there is no one symbol that is true of the row.
   */
  unitKnown?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <Cluster gap="sm" justify="start">
      <FieldLabel htmlFor={id}>
        <Icon size={14} />
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
      {/* The bare symbol beside the box, through `<Unit>` rather than as text,
          so it is styled and announced as a word like every other unit on the
          board. */}
      {unitKnown && <Unit>m/s</Unit>}
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
 * trying. Which plan slot those burns belong to, and whether there is a slot at
 * all, is `PlanSlots` above: this section edits the burns INSIDE whichever plan
 * that names.</para>
 */
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
  const [lastWrite, setLastWrite] = useState<PrincipiaPlanWriteReceipt | null>(
    null,
  );
  /*
   * The arm's receipt is kept apart from the burn edits' because the two are
   * read in different places: the burn banner lives inside the form, which is
   * only on screen once a burn is selected, and an arm is the press an operator
   * makes BEFORE there is one.
   */
  const [lastArm, setLastArm] = useState<PrincipiaPlanWriteReceipt | null>(
    null,
  );

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

  const { plan, outOfContact } = view;
  const surface = plan.writeSurface;
  const armed = surface?.armed === true;
  const available = surface?.available === true;
  const burns = plan.burns ?? [];
  const vesselId = plan.vesselId ?? undefined;

  // The four handles carry the same vantage, so one of them answers for all
  // four. Taken off the replace handle because APPLY is the write the deadline
  // is about.
  const oneWaySeconds = replaceCmd.effectiveDelaySeconds;
  const draftWindow = editWindow(
    draft?.ignitionUt ?? null,
    viewUt,
    oneWaySeconds,
  );

  const selected =
    draft === null
      ? undefined
      : burns.find((burn) => magnitudeOf(burn.index) === draft.burnIndex);
  // The producer's Cartesian system, the one whose three Dv slots are three
  // velocities. Its other three are spherical and put a magnitude and two
  // ANGLES in the same slots, so the components are neither editable nor
  // readable as m/s. Compared against the ordinal the payload carries rather
  // than mapped to a name: the set is the producer's, and a stale mapping here
  // would mislabel a burn's basis.
  const CARTESIAN_TNB = 1;
  const componentsUnreadable =
    selected !== undefined &&
    magnitudeOf(selected.coordinateSystem) !== CARTESIAN_TNB;
  const frozen =
    !armed ||
    selected?.frameEditable !== true ||
    componentsUnreadable ||
    outOfContact !== null;
  /*
   * The ignition field stays live inside a shut window: pushing the burn further
   * out is how the operator REOPENS one, and freezing the field would leave the
   * deadline as a dead end rather than something to act on.
   */
  const tooLate = draftWindow?.shut === true;

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
          {outOfContact !== null && (
            <Badge severity="warning">OUT OF CONTACT</Badge>
          )}
        </Cluster>

        {/* Beside the badge rather than instead of it: the badge is what catches
            the eye and the sentence is what says which of the three things to go
            and check. */}
        {outOfContact !== null && (
          <Text tone="faint" size="sm">
            {outOfContact}
          </Text>
        )}

        {/* Arming is a real write of Principia's own burn back into the plan, so
            it confirms rather than firing on the first press. */}
        <Stack gap="xs">
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
              onConfirmed={(result) => setLastArm(planWriteReceipt(result))}
            />
            {surface?.reason && (
              <Text tone="faint" size="sm">
                {surface.reason}
              </Text>
            )}
          </Cluster>

          {/* An arm that was answered from the mod's own store granted nothing,
              and this is the only thing on screen that says so. The request id
              is composed from the vessel alone, so it never varies: every press
              after the first sends the id the first went under, and the mod
              answers it out of its receipt cache without touching the write
              surface. Both resolve, so the control shows the same confirmation
              either way. Live-regioned because it is the outcome of something
              the operator just pressed and it contradicts the badge above. */}
          {nothingWasWritten(lastArm) && (
            <Stack gap="xs" role="status" aria-live="polite">
              <Cluster justify="start">
                <Badge severity="warning">NOTHING WAS WRITTEN</Badge>
              </Cluster>
              {lastArm.replayed === true ? (
                <Text tone="faint" size="sm">
                  This arm matched one already sent, so the mod answered with
                  the earlier receipt instead of arming again. The badge above
                  is what the surface actually holds.
                </Text>
              ) : (
                <Text tone="faint" size="sm">
                  {planWriteRefusalLine(lastArm)}
                </Text>
              )}
            </Stack>
          )}
        </Stack>

        <Stack gap="xs">
          <Text tone="faint" size="sm">
            {`PLAN ENDS ${plan.desiredFinalTimeUt == null ? NULL_DISPLAY : ""}`}
            {plan.desiredFinalTimeUt != null && (
              <MissionDate value={plan.desiredFinalTimeUt} />
            )}
          </Text>
          {burns.length === 0 && (
            <Text>
              This plan has no burns. Compose one below and send it: the editor
              here changes burns that already exist.
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
                  {/* On the row as well as in the form. An operator picks a burn
                      off this list before any form exists, and a list that
                      offers one nothing sent can still reach is what sends them
                      into a form to compose an edit that cannot land. */}
                  {editWindow(ignition, viewUt, oneWaySeconds)?.shut ===
                    true && <Badge severity="warning">TOO LATE TO EDIT</Badge>}
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
                  is on this line. Declined with the burn's OWN bodies: the kind
                  alone renders its template with the body slot still standing,
                  and two burns centred on different bodies are the same kind and
                  not the same frame. */}
              <Text tone="faint" size="sm">
                {plottingFrameLabel(magnitudeOf(selected.frameType), {
                  centre: selected.centreBody,
                  primary: selected.primaryBody,
                  secondary: selected.secondaryBody,
                })}
              </Text>
              {selected.frameEditable === false && (
                <Badge severity="warning">
                  THIS FRAME CANNOT BE WRITTEN BACK
                </Badge>
              )}
              {componentsUnreadable && (
                <Badge severity="warning">DELTA-V NOT IN COMPONENTS</Badge>
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

            {/* Above the fields, not below the buttons. The deadline is what
                decides whether composing an edit at all is worth doing, so it is
                read before anything is typed. */}
            {draftWindow !== null && (
              <Stack gap="xs" data-edit-window="">
                <Cluster gap="sm" wrap justify="start">
                  {draftWindow.shut ? (
                    <Badge severity="warning">EDIT WINDOW SHUT</Badge>
                  ) : (
                    <Badge severity="caution">
                      EDIT WINDOW{" "}
                      <Countdown value={draftWindow.remainingSeconds} clock />
                    </Badge>
                  )}
                </Cluster>
                <Text tone="faint" size="sm">
                  {draftWindow.shut
                    ? "An edit sent now reaches Principia after this burn has ignited, so the burn flies as it stands. Move the ignition later, or edit a later burn."
                    : "Past this the edit arrives after ignition and the burn flies as it stands."}{" "}
                  The window shuts at{" "}
                  <MissionDate value={value("ut", draftWindow.deadlineUt)} />,{" "}
                  <Countdown value={2 * draftWindow.oneWaySeconds} /> before the
                  ignition above: one light time because the plan on screen is
                  that old, and a second because the edit has the same distance
                  to travel back.
                </Text>
              </Stack>
            )}

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
              {/* Beside the boxes rather than instead of them: the numbers are
                  what the producer holds and hiding them would leave an
                  operator unable to see the burn at all. What is withdrawn is
                  the claim that they are three velocities, and the ability to
                  send an edit the producer would refuse a light time later. */}
              {componentsUnreadable && (
                <Text tone="faint" size="sm">
                  This burn states its delta-v in one of Principia's spherical
                  coordinate systems, which carries a magnitude and two angles
                  rather than three components. The three numbers below are that
                  triple, so they are not metres per second and cannot be edited
                  here. Switch the burn to Cartesian in-game first.
                </Text>
              )}
              <DeltaVRow
                id="burn-dv-tangent"
                icon={TangentIcon}
                label="TANGENT"
                hint="prograde"
                value={draft.tangent}
                disabled={frozen}
                unitKnown={!componentsUnreadable}
                onChange={(next) => setDraft({ ...draft, tangent: next })}
              />
              <DeltaVRow
                id="burn-dv-normal"
                icon={FrenetNormalIcon}
                label="NORMAL"
                value={draft.normal}
                disabled={frozen}
                unitKnown={!componentsUnreadable}
                onChange={(next) => setDraft({ ...draft, normal: next })}
              />
              <DeltaVRow
                id="burn-dv-binormal"
                icon={BinormalIcon}
                label="BINORMAL"
                value={draft.binormal}
                disabled={frozen}
                unitKnown={!componentsUnreadable}
                onChange={(next) => setDraft({ ...draft, binormal: next })}
              />
              <Row as="div">
                <RowName>MAGNITUDE</RowName>
                {/* Built as a VALUE and rendered by `<Unit>`, not written out
                    beside the number: the magnitude is derived here, so this is
                    the one place on the row where the unit could disagree with
                    what it is measuring.

                    A hypotenuse is only the size of the burn when the three
                    slots are three components of it. Over a magnitude and two
                    angles it is a number with no meaning, and one that reads as
                    a plausible delta-v, so the dash is the honest answer. */}
                {componentsUnreadable ? (
                  <Text>{NULL_DISPLAY}</Text>
                ) : (
                  <Unit
                    value={value("m/s", deltaVMagnitude(draft))}
                    decimals={1}
                  />
                )}
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
                onConfirmed={(result) => setLastWrite(planWriteReceipt(result))}
                disabled={frozen || tooLate}
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
                onConfirmed={(result) => setLastWrite(planWriteReceipt(result))}
                /*
                 * The same deadline: an inserted burn is written at the draft's
                 * ignition too, so one composed for an instant the write cannot
                 * beat is a burn added to the plan already in the past.
                 */
                disabled={frozen || tooLate}
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
                onConfirmed={(result) => setLastWrite(planWriteReceipt(result))}
                // Out of contact freezes this too: the index is the whole of the
                // request, and an index off an hour-old burn list can name a
                // different burn by the time it arrives. NOT frozen by the edit
                // deadline, though, because dropping a burn that has already
                // flown is how a plan gets tidied and is the one write with
                // nothing to beat.
                disabled={!armed || outOfContact !== null}
                aria-label="Remove this burn from the plan"
                confirmAriaLabel="Confirm removing this burn from the plan"
              />
            </Cluster>

            {/* A confirmed dispatch is not always a write, and the RECEIPT is
                what says so: the mod answers a repeated request id with the one
                it stored the first time without calling the plugin, and a
                receipt can report an outcome that is not `Written` whatever the
                envelope around it said. The control's own success state sees
                neither, because both resolve. Live-regioned because it is the
                outcome of something the operator just pressed, and it
                contradicts what the button beside it is showing. */}
            {nothingWasWritten(lastWrite) && (
              <Stack gap="xs" role="status" aria-live="polite">
                <Cluster justify="start">
                  <Badge severity="warning">NOTHING WAS WRITTEN</Badge>
                </Cluster>
                {lastWrite.replayed === true ? (
                  <Text tone="faint" size="sm">
                    This edit matched one already sent, so the mod answered with
                    the earlier receipt instead of writing again. The plan still
                    holds whatever the last write that DID land put there.
                    Change a value and send again.
                  </Text>
                ) : (
                  <Text tone="faint" size="sm">
                    {planWriteRefusalLine(lastWrite)}
                  </Text>
                )}
              </Stack>
            )}

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
