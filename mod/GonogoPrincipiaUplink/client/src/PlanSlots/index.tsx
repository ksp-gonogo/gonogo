import type { ComposedBurn, PlanDraft } from "@ksp-gonogo/sitrep-sdk";
import {
  ManeuverFrame,
  registerAugment,
  useCommand,
  usePlanDrafts,
  useTelemetry,
  useViewUt,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  CommandButton,
  Countdown,
  MissionDate,
  MissionDateField,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type {
  PrincipiaComposedBurn,
  PrincipiaPlan,
  PrincipiaPlanWriteReceipt,
} from "../__generated__/contract";
import { PrincipiaBurnProfile } from "../__generated__/contract";
import { commandWindow } from "../commandWindow";
import { planView } from "../planReading";
import type { PrincipiaPlanWriteHandle } from "../planWrite";
import {
  nothingWasWritten,
  planWriteReceipt,
  planWriteRefusalLine,
} from "../planWrite";
import { PRINCIPIA } from "../uplink";
import "../topics";

/**
 * Principia's ten-plan cap, reproduced because the wire carries the count and
 * not the ceiling.
 *
 * <p>An eleventh plan makes Principia's own planner window throw on every layout
 * pass, for as long as the window is open, with the button that would delete it
 * inside the part that stopped drawing. So the count is worth showing against
 * the limit rather than on its own, and a console that let an operator walk up
 * to it blind would be handing them that state.</p>
 */
const MAX_FLIGHT_PLANS = 10;

/**
 * How far past the round trip a newly created plan is asked to end, and the
 * value Principia's own planner asks for when the operator gives it nothing.
 */
const DEFAULT_PLAN_LENGTH_SECONDS = 3600;

/**
 * The plan slot itself: whether this craft has a flight plan, which of its ten
 * it is, and the four writes that change that answer.
 *
 * <p><b>Why one section rather than four controls.</b> Create, install, copy and
 * delete are not four independent verbs, they are the transitions of one state
 * machine over two fields of the reading. `planExists` decides whether create or
 * delete is the legal one and the plugin REFUSES the other by name
 * (`PlanAlreadyExists`, `NoFlightPlan`); `planCount` against Principia's ten
 * decides whether a copy can be made at all. A surface offering all four at once
 * would be a surface that refuses most of its own controls a light time after
 * they are pressed, which is the thing `writeSurface` exists on the wire to
 * prevent.</p>
 *
 * <p><b>Why installing a composed plan belongs here and not in the composer.</b>
 * A plan arrives on a craft one of three ways: empty, copied, or composed
 * elsewhere and transmitted whole. All three are the same transition, and the
 * mod says so: `principia.plan.send` CREATES the slot when the craft holds none,
 * rather than refusing and making the operator send a create first from a light
 * time away. So install and create differ only in whether there are burns in the
 * box, and they share the one field neither the composer nor the burn editor
 * holds: where the plan is asked to end. The composer's own upload is a
 * different destination entirely, stock manoeuvre nodes, and that is why it
 * stays where it is rather than growing a second button.</p>
 *
 * <p><b>There is one plan-end field on this panel and it is not always this
 * one.</b> A plan that exists already has an end, and the control that MOVES it
 * belongs beside the shortfall it remedies, which is `PlanIntegrationBlock`. So
 * the field here appears only for a craft with no plan, and once there is one its
 * own end is the end every write reads. Two fields under one name on one panel is
 * two answers to the same question.</p>
 *
 * <p>The burns themselves are edited in `BurnEditor` below, which works inside
 * whichever slot this names. Nothing here reads or writes a burn.</p>
 */
export function PlanSlots() {
  const view = planView(useTelemetry("principia.plan"));
  const viewUt = useViewUt();

  const createCmd = useCommand("principia.plan.create");
  const duplicateCmd = useCommand("principia.plan.duplicate");
  const deleteCmd = useCommand("principia.plan.delete");
  const sendCmd = useCommand("principia.plan.send");
  usePanelDelay(createCmd);
  usePanelDelay(duplicateCmd);
  usePanelDelay(deleteCmd);
  usePanelDelay(sendCmd);

  const { drafts } = usePlanDrafts();
  /**
   * The end instant the next create or install will ask for, once the operator
   * has moved it. Null until then, so the seeded value below tracks the view
   * clock instead of freezing at whatever it was on the first render.
   */
  const [endDraft, setEndDraft] = useState<number | null>(null);
  const [lastWrite, setLastWrite] = useState<PrincipiaPlanWriteReceipt | null>(
    null,
  );

  if (view.kind === "none") {
    return (
      <Section data-plan-slots="">
        <SectionTitle>PLAN SLOTS</SectionTitle>
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
  const planExists = plan.planExists === true;
  const vesselId = plan.vesselId ?? undefined;
  const burns = plan.burns ?? [];
  const planCount = magnitudeOf(plan.planCount) ?? 0;
  const slotsFull = planCount >= MAX_FLIGHT_PLANS;

  // The four handles carry the same vantage, so one answers for all four.
  const oneWaySeconds = createCmd.effectiveDelaySeconds;
  /*
   * Two one-way light times past the view instant: the reading on screen is
   * already one behind, and the write spends a second in flight. Through the
   * algebra rather than on bare numbers, because it is an instant plus an
   * interval and the units say which is which.
   */
  const arrival =
    viewUt === undefined
      ? null
      : viewUt.plus(value("s", 2 * Math.max(oneWaySeconds, 0)));
  const arrivalUt = magnitudeOf(arrival);
  const seededEndUt = magnitudeOf(
    arrival?.plus(value("s", DEFAULT_PLAN_LENGTH_SECONDS)),
  );
  const viewUtNumber = magnitudeOf(viewUt);
  /*
   * ONE instant, and which control owns it depends on whether there is a plan.
   * A plan that exists already HAS an end, and the control that moves it sits
   * beside the shortfall it remedies (`PlanIntegrationBlock`); a second field
   * here would be a second answer to the same question, on the same panel, under
   * the same name. So the field below appears only where the plan does not, and
   * once it does the plan's own end is the end.
   */
  const endUt = planExists
    ? magnitudeOf(plan.desiredFinalTimeUt)
    : (endDraft ?? seededEndUt);

  /*
   * Frozen for the same three reasons every write on this Uplink is: the surface
   * is not armed, the reading the slot count came off is stale, or Principia is
   * mid-optimisation and would revert the write without reporting it.
   */
  const frozen =
    !armed || outOfContact !== null || plan.optimisationRunning === true;

  const installable = drafts.filter(
    (draft) => draft.vesselId === vesselId && draft.saved === true,
  );

  return (
    <Section data-plan-slots="">
      <SectionTitle>PLAN SLOTS</SectionTitle>
      <Stack>
        <Cluster wrap justify="start" gap="sm">
          {/* Which slot, out of how many. Every number the sections below show
              belongs to whichever this names, and an operator reading a plan
              they are not flying is the failure mode ten parallel plans
              creates.

              Only where there IS one, because the producer's "none selected" is
              minus one and a badge reading "PLAN 0 OF 0" beside the badge that
              says there is no plan is a second, worse way of saying so. */}
          {planExists ? (
            <Badge severity="info">
              {`PLAN ${(magnitudeOf(plan.selectedPlan) ?? -1) + 1} OF ${planCount}`}
            </Badge>
          ) : (
            <Badge severity="caution">NO PLAN ON THIS VESSEL</Badge>
          )}
          {slotsFull && (
            <Badge severity="warning">{`SLOTS FULL AT ${MAX_FLIGHT_PLANS}`}</Badge>
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

        {/* The mod's own sentence, not one composed here: it names the guard
            that is standing in the way, and for a craft with no plan it says
            which write is the one available. */}
        {surface?.reason && (
          <Text tone="faint" size="sm">
            {surface.reason}
          </Text>
        )}

        {/* Beside the badge rather than instead of it: the badge catches the
            eye and the sentence says which of the three things to check. */}
        {outOfContact !== null && (
          <Text tone="faint" size="sm">
            {outOfContact}
          </Text>
        )}

        <Stack gap="xs">
          {/* The slot's extent. `initialTimeUt` is where Principia began
              integrating this plan and appears nowhere else on the board; the
              length below it is the same pair read as a duration, which is the
              form an operator judges a horizon in. An instant and an interval
              are different quantities and are rendered as such. */}
          <Row as="div">
            <RowName>PLAN STARTS</RowName>
            {plan.initialTimeUt == null ? (
              <Text>{NULL_DISPLAY}</Text>
            ) : (
              <MissionDate value={plan.initialTimeUt} />
            )}
          </Row>
          <Row as="div">
            <RowName>PLAN RUNS FOR</RowName>
            {plan.initialTimeUt == null || plan.desiredFinalTimeUt == null ? (
              <Text>{NULL_DISPLAY}</Text>
            ) : (
              <Countdown
                value={plan.desiredFinalTimeUt.minus(plan.initialTimeUt)}
              />
            )}
          </Row>
          <Row as="div">
            <RowName>BURNS</RowName>
            <Unit value={value("count", burns.length)} decimals={0} />
          </Row>
        </Stack>

        {planExists ? (
          <ExistingPlan
            plan={plan}
            vesselId={vesselId}
            frozen={frozen}
            slotsFull={slotsFull}
            planCount={planCount}
            burnCount={burns.length}
            nextIgnitionUt={nextIgnitionUt(plan)}
            viewUt={viewUtNumber}
            oneWaySeconds={oneWaySeconds}
            duplicateCmd={duplicateCmd}
            deleteCmd={deleteCmd}
            onWrite={setLastWrite}
          />
        ) : null}

        {/* Where a plan that does not exist yet would end. Above both writes
            that state one rather than inside either, because it is the one field
            create and install share and a second copy could disagree with the
            first. */}
        {!planExists && (
          <Stack gap="xs">
            <SectionTitle>NEW PLAN ENDS AT</SectionTitle>
            {endUt === null ? (
              <Text tone="faint" size="sm">
                No view clock, so there is no instant to measure a plan's end
                against.
              </Text>
            ) : (
              <>
                <MissionDateField
                  label="New plan end"
                  value={endUt}
                  disabled={frozen}
                  onChange={setEndDraft}
                />
                <Row as="div">
                  <RowName>LENGTH FROM ARRIVAL</RowName>
                  {arrivalUt === null ? (
                    <Text>{NULL_DISPLAY}</Text>
                  ) : (
                    <Countdown value={value("s", endUt - arrivalUt)} />
                  )}
                </Row>
                {arrivalUt !== null && endUt <= arrivalUt && (
                  <Text tone="warn" size="sm">
                    This end instant has already passed by the time the write
                    arrives, and Principia asserts on a plan that ends before it
                    starts rather than answering an error. Move it later.
                  </Text>
                )}
              </>
            )}
            <Cluster gap="sm" wrap justify="start">
              <CommandButton
                size="sm"
                tone="go"
                handle={createCmd}
                args={{
                  vesselId,
                  requestId: `create-${vesselId ?? "none"}-${endUt ?? "none"}`,
                  finalTimeUt: endUt ?? undefined,
                }}
                commandLabel="Create a flight plan"
                label="CREATE EMPTY PLAN"
                confirmLabel="CONFIRM CREATE"
                confirmTone="nogo"
                pendingLabel="Creating..."
                onConfirmed={(result) => setLastWrite(planWriteReceipt(result))}
                disabled={
                  frozen ||
                  endUt === null ||
                  (arrivalUt !== null && endUt <= arrivalUt)
                }
                aria-label="Create a flight plan for this vessel"
                confirmAriaLabel="Confirm creating a flight plan for this vessel"
              />
            </Cluster>
          </Stack>
        )}

        <InstallDrafts
          drafts={installable}
          plan={plan}
          vesselId={vesselId}
          endUt={endUt}
          arrivalUt={arrivalUt}
          viewUt={viewUtNumber}
          oneWaySeconds={oneWaySeconds}
          frozen={frozen}
          burnCount={burns.length}
          sendCmd={sendCmd}
          onWrite={setLastWrite}
        />

        {/* A confirmed dispatch is not always a write, and the RECEIPT is what
            says so: the mod answers a repeated request id with the one it stored
            the first time and never touches the plugin, and a receipt can report
            an outcome that is not `Written` whatever the envelope around it
            said. The control's own success state sees neither, because both
            resolve. Live-regioned because it is the outcome of something the
            operator just pressed and it contradicts what the button beside it is
            showing. */}
        {nothingWasWritten(lastWrite) && (
          <Stack gap="xs" role="status" aria-live="polite">
            <Cluster justify="start">
              <Badge severity="warning">NOTHING WAS WRITTEN</Badge>
            </Cluster>
            {lastWrite.replayed === true ? (
              <Text tone="faint" size="sm">
                This matched a request already sent, so the mod answered with
                the earlier receipt instead of writing again. The slot still
                holds whatever the last write that DID land put there.
              </Text>
            ) : (
              <Text tone="faint" size="sm">
                {planWriteRefusalLine(lastWrite)}
              </Text>
            )}
          </Stack>
        )}

        {/* The values above came off a reading, and every write below is
            bounded against the slot count that reading carried. */}
        <Text tone="faint" size="sm">
          Slot state as read at{" "}
          {plan.sampledAtUt == null ? (
            NULL_DISPLAY
          ) : (
            <MissionDate value={plan.sampledAtUt} />
          )}
          .
        </Text>
      </Stack>
    </Section>
  );
}

/**
 * The two writes that only exist once a plan does: copy it, or throw it away.
 *
 * <p>Split out because their preconditions are the negation of create's, and a
 * component holding both sets would spend most of its body deciding which half
 * of itself to render.</p>
 */
function ExistingPlan({
  plan,
  vesselId,
  frozen,
  slotsFull,
  planCount,
  burnCount,
  nextIgnitionUt,
  viewUt,
  oneWaySeconds,
  duplicateCmd,
  deleteCmd,
  onWrite,
}: Readonly<{
  plan: PrincipiaPlan;
  vesselId: string | undefined;
  frozen: boolean;
  slotsFull: boolean;
  planCount: number;
  burnCount: number;
  /** The next burn still ahead of the reading, when the plan names one. */
  nextIgnitionUt: number | null;
  viewUt: number | null;
  oneWaySeconds: number;
  duplicateCmd: PrincipiaPlanWriteHandle;
  deleteCmd: PrincipiaPlanWriteHandle;
  onWrite: (receipt: PrincipiaPlanWriteReceipt | null) => void;
}>) {
  const executing = (plan.burns ?? []).some((burn) => burn.executing === true);
  /*
   * Deleting a plan has nothing to beat in the way an edit to a burn does: the
   * write is legal at any instant. What it CAN do is arrive after a burn the
   * operator meant to stop has already lit, and at a distant vantage the row
   * saying so is still an hour from telling them. So the window is measured
   * against the next ignition and reported, not enforced.
   */
  const nextBurnWindow = commandWindow(nextIgnitionUt, viewUt, oneWaySeconds);

  return (
    <Stack gap="xs" data-plan-slots-existing="">
      <Cluster gap="sm" wrap justify="start">
        <CommandButton
          size="sm"
          handle={duplicateCmd}
          args={{
            vesselId,
            requestId: `duplicate-${vesselId ?? "none"}-${planCount}`,
          }}
          commandLabel="Copy this flight plan into a new slot"
          label="COPY TO A NEW SLOT"
          confirmLabel="CONFIRM COPY"
          confirmTone="nogo"
          pendingLabel="Copying..."
          onConfirmed={(result) => onWrite(planWriteReceipt(result))}
          disabled={frozen || slotsFull}
          aria-label="Copy this flight plan into a new slot"
          confirmAriaLabel="Confirm copying this flight plan into a new slot"
        />
        <CommandButton
          size="sm"
          handle={deleteCmd}
          args={{ vesselId, requestId: `delete-${vesselId ?? "none"}` }}
          commandLabel="Delete this flight plan"
          label="DELETE PLAN"
          confirmLabel="CONFIRM DELETE"
          confirmTone="nogo"
          pendingLabel="Deleting..."
          onConfirmed={(result) => onWrite(planWriteReceipt(result))}
          disabled={frozen}
          aria-label="Delete this flight plan"
          confirmAriaLabel="Confirm deleting this flight plan"
        />
      </Cluster>

      {/* What a delete costs, from the reading rather than from the press. The
          count is the BURNS row above; repeating it inside a sentence would put
          the same number on the panel twice. */}
      {burnCount > 0 && (
        <Text tone="faint" size="sm">
          Deleting this slot discards the burns above with it. Copying it first
          leaves the original in place.
        </Text>
      )}

      {executing && (
        <Cluster justify="start">
          <Badge severity="critical">A BURN IS RUNNING</Badge>
        </Cluster>
      )}

      {nextBurnWindow?.shut === true && (
        <Text tone="warn" size="sm">
          The next burn lights before a write sent now reaches Principia, so it
          flies whatever this slot holds. The window shut at{" "}
          <MissionDate value={value("ut", nextBurnWindow.deadlineUt)} />.
        </Text>
      )}
    </Stack>
  );
}

/**
 * The screen's saved plans, and what installing one on this craft would do.
 *
 * <p>Only SAVED drafts. A draft still being composed is a command-centre object
 * the operator has not finished with, and offering to transmit one is offering
 * to fly a half-typed trajectory.</p>
 *
 * <p><b>Every fact that would refuse the install is rendered from the draft
 * itself.</b> Principia takes a burn as three components of the Frenet
 * trihedron, so a draft composed in the stock radial/normal/prograde basis is
 * not the same burn under those three names and is refused here rather than
 * reinterpreted; a plan whose first burn cannot be reached before it lights is
 * refused whole by the mod on arrival; and an end instant at or before the last
 * ignition is a plan that would not reach its own last manoeuvre.</p>
 */
function InstallDrafts({
  drafts,
  plan,
  vesselId,
  endUt,
  arrivalUt,
  viewUt,
  oneWaySeconds,
  frozen,
  burnCount,
  sendCmd,
  onWrite,
}: Readonly<{
  drafts: readonly PlanDraft[];
  plan: PrincipiaPlan;
  vesselId: string | undefined;
  endUt: number | null;
  arrivalUt: number | null;
  viewUt: number | null;
  oneWaySeconds: number;
  frozen: boolean;
  burnCount: number;
  sendCmd: PrincipiaPlanWriteHandle;
  onWrite: (receipt: PrincipiaPlanWriteReceipt | null) => void;
}>) {
  return (
    <Stack gap="xs" data-plan-slots-install="">
      <SectionTitle>INSTALL A COMPOSED PLAN</SectionTitle>
      {drafts.length === 0 ? (
        <Text tone="faint" size="sm">
          No saved plan for this craft. A composed plan reaches Principia's
          flight plan from here; the composer's own upload writes stock
          manoeuvre nodes instead.
        </Text>
      ) : null}
      {drafts.map((draft, index) => (
        <InstallRow
          key={draft.id}
          draft={draft}
          ordinal={index + 1}
          plan={plan}
          vesselId={vesselId}
          endUt={endUt}
          arrivalUt={arrivalUt}
          viewUt={viewUt}
          oneWaySeconds={oneWaySeconds}
          frozen={frozen}
          burnCount={burnCount}
          sendCmd={sendCmd}
          onWrite={onWrite}
        />
      ))}
    </Stack>
  );
}

function InstallRow({
  draft,
  ordinal,
  plan,
  vesselId,
  endUt,
  arrivalUt,
  viewUt,
  oneWaySeconds,
  frozen,
  burnCount,
  sendCmd,
  onWrite,
}: Readonly<{
  draft: PlanDraft;
  ordinal: number;
  plan: PrincipiaPlan;
  vesselId: string | undefined;
  endUt: number | null;
  arrivalUt: number | null;
  viewUt: number | null;
  oneWaySeconds: number;
  frozen: boolean;
  burnCount: number;
  sendCmd: PrincipiaPlanWriteHandle;
  onWrite: (receipt: PrincipiaPlanWriteReceipt | null) => void;
}>) {
  const wrongBasis = draft.burns.some(
    (burn) => burn.frame !== ManeuverFrame.TangentNormalBinormal,
  );
  const first = draft.burns[0];
  const window = commandWindow(
    magnitudeOf(first?.ignitionUt),
    viewUt,
    oneWaySeconds,
  );
  const lastIgnitionUt = magnitudeOf(
    draft.burns[draft.burns.length - 1]?.ignitionUt,
  );
  /*
   * The draft's own end wins where it states one: the operator who composed the
   * plan said how far it runs, and the field above is the slot's default for
   * every plan that did not. Nothing writes it today, which is why the default
   * is the reachable one rather than the exception.
   */
  const planEndUt = draft.desiredFinalTimeUt ?? endUt;
  const endsBeforeLastBurn =
    planEndUt !== null &&
    lastIgnitionUt !== null &&
    planEndUt <= lastIgnitionUt;
  /*
   * An arm is not a burn verdict, and `SendPlan` gates on the verdict only when
   * the slot ALREADY HOLDS BURNS: a plan sent to a craft holding none builds its
   * head burn, which is its own demonstration of the struct. `armed` true beside
   * an unverified burn struct is a state the mod reaches and publishes, so the
   * two halves of that gate are both read here rather than one of them.
   */
  const burnStructUnusable =
    burnCount > 0 && plan.writeSurface?.burnLayoutVerified !== true;
  const blocked =
    frozen ||
    wrongBasis ||
    burnStructUnusable ||
    planEndUt === null ||
    endsBeforeLastBurn ||
    window?.shut === true ||
    (arrivalUt !== null && planEndUt <= arrivalUt);

  return (
    <Stack gap="xs">
      <Row as="div">
        <RowName>{`SAVED PLAN ${ordinal}`}</RowName>
        <Cluster justify="end" gap="sm">
          <Unit value={value("count", draft.burns.length)} decimals={0} />
          {first ? <MissionDate value={first.ignitionUt} /> : null}
        </Cluster>
      </Row>

      <CommandButton
        size="sm"
        tone="go"
        handle={sendCmd}
        args={{
          vesselId,
          /*
           * The draft's CONTENT is the intent, never its id alone: the mod
           * answers a request id it has already seen out of its replay cache
           * without looking at the plan that came with it, so a corrected plan
           * resent under the id its earlier version went under is answered
           * "aboard" about a trajectory the craft has never seen. `revision`
           * counts the content, and the end instant is stated here rather than
           * in the draft, so it joins the key.
           */
          requestId: `send-${draft.id}@${draft.revision}-${planEndUt ?? "none"}`,
          composedAtViewUt: viewUt ?? undefined,
          observedAtUt: magnitudeOf(draft.observedAt) ?? undefined,
          desiredFinalTimeUt: planEndUt ?? undefined,
          burns: draft.burns.map(composedBurn),
        }}
        commandLabel="Install this plan as Principia's flight plan"
        label="INSTALL AS FLIGHT PLAN"
        confirmLabel="CONFIRM INSTALL"
        confirmTone="nogo"
        pendingLabel="Installing..."
        onConfirmed={(result) => onWrite(planWriteReceipt(result))}
        disabled={blocked}
        aria-label="Install this plan as Principia's flight plan"
        confirmAriaLabel="Confirm installing this plan as Principia's flight plan"
      />

      {/* What an install REPLACES. A slot already holding burns is overwritten
          whole, and there is no undo from the operator's seat. */}
      {burnCount > 0 && plan.planExists === true && (
        <Text tone="faint" size="sm">
          This overwrites the burns the slot holds now, whole.
        </Text>
      )}

      {wrongBasis && (
        <Text tone="warn" size="sm">
          This plan states a burn in KSP's radial/normal/prograde basis.
          Principia's burns are the Frenet trihedron, so the same three numbers
          are a different manoeuvre and this plan cannot be installed as it
          stands.
        </Text>
      )}

      {burnStructUnusable && (
        <Text tone="warn" size="sm">
          Principia's burn struct has not survived a round trip in this session,
          and this slot already holds burns to copy from, so the mod refuses the
          install. A slot holding none builds its head burn instead and is not
          held to the verdict.
        </Text>
      )}

      {endsBeforeLastBurn && (
        <Text tone="warn" size="sm">
          The plan end above is at or before this plan's last ignition, so the
          plan would not reach its own last manoeuvre.
        </Text>
      )}

      {window?.shut === true && (
        <Text tone="warn" size="sm">
          The first burn lights before this plan could reach the craft, and the
          mod refuses the whole plan rather than installing the burns still
          ahead. The window shut at{" "}
          <MissionDate value={value("ut", window.deadlineUt)} />,{" "}
          <Countdown value={value("s", 2 * window.oneWaySeconds)} /> before
          ignition: one light time because the reading is that old, and a second
          because the plan has the same distance to travel back.
        </Text>
      )}
    </Stack>
  );
}

/**
 * A composed burn in the shape Principia's own command takes.
 *
 * <p>The three slots carry the BASIS's components in the basis's own order, and
 * the basis is asserted by the caller rather than assumed here: under
 * `ManeuverFrame.TangentNormalBinormal` the first slot is the tangent and the
 * third is the binormal. Labelling them by their field names would put an
 * operator's along-track burn out of plane, which is a wrong burn that reads as
 * a right one.</p>
 *
 * <p>`Unchanged` is not available to a composed plan: a plan transmitted from a
 * command centre states its burns outright rather than as a delta against a
 * value the sender could not see, and the profile is the one field of the burn
 * the composer does not offer, so the plan keeps whichever engine Principia
 * already has.</p>
 *
 * <p><b>MAGNITUDES, not `Value`s, and the cast is what that costs.</b>
 * `PrincipiaComposedBurn` is carried INSIDE an args record rather than being
 * one, so codegen's "an Args type is a wire-WRITE" exemption does not reach it
 * and types its instant and its components as unit-bound values. That is right
 * for everything that reads a burn, and it is what a draft holds. It is not what
 * the receiving side binds: `ChannelEngine.BindCommandArgs` takes each to a
 * plain double and rejects an object bag with "Cannot bind wire value of type
 * Dictionary to numeric Double", thrown from inside the handler, so the whole
 * plan is lost rather than one field. The sdk's `planSendArgs` unwraps at the
 * same boundary for the same reason.</p>
 */
function composedBurn(burn: ComposedBurn): PrincipiaComposedBurn {
  return {
    ignitionUt: burn.ignitionUt.magnitude,
    deltaVTangent: burn.dvRadial.magnitude,
    deltaVNormal: burn.dvNormal.magnitude,
    deltaVBinormal: burn.dvPrograde.magnitude,
    inertiallyFixed: burn.inertiallyFixed,
    profile: PrincipiaBurnProfile.Unchanged,
  } as unknown as PrincipiaComposedBurn;
}

/**
 * The next burn still ahead of the reading, as an instant.
 *
 * <p>Off `firstFutureBurnIndex` rather than by searching the list, because that
 * index is the rule Principia's own panel applies and no two clients should have
 * to agree on it independently. Null when every burn is behind the sample, which
 * is a plan with nothing left to miss.</p>
 */
function nextIgnitionUt(plan: PrincipiaPlan): number | null {
  const index = magnitudeOf(plan.firstFutureBurnIndex);
  if (index === null) return null;
  const burn = (plan.burns ?? []).find(
    (candidate) => magnitudeOf(candidate.index) === index,
  );
  return burn === undefined ? null : magnitudeOf(burn.ignitionUt);
}

registerAugment({
  id: "principia-plan-slots",
  augments: "maneuver-planner.sections",
  component: PlanSlots,
  owner: PRINCIPIA,
});
