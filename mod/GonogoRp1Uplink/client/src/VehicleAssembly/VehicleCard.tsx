import {
  Badge,
  Cluster,
  CommandButton,
  Countdown,
  magnitudeOf,
  NULL_DISPLAY,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type {
  Rp1BuildItemEntry,
  Rp1ComplexEntry,
  Rp1OperationEntry,
  Rp1PadEntry,
  Rp1WarehouseItemEntry,
} from "../__generated__/contract";
import { ProjectCard } from "../shared/ProjectCard";
import {
  atPad,
  eligiblePadNames,
  rolloutBillOf,
  rolloutRefusalsOf,
  settled,
  unstaffed,
  type Vehicle,
  withheldRolloutReason,
} from "./vehicles";

/** The three command handles a vehicle card can dispatch. */
export type VehicleHandles = Readonly<{
  rollout: Parameters<typeof CommandButton>[0]["handle"];
  rollback: Parameters<typeof CommandButton>[0]["handle"];
  scrap: Parameters<typeof CommandButton>[0]["handle"];
}>;

/**
 * One vehicle: what it is, where it has got to, what it cost, why its clock
 * reads what it reads, and every action that acts on THIS copy of it. Moving it
 * to a pad, bringing it back and scrapping it are all of them; nothing here
 * starts a build, because RP-1 exposes no command that starts one.
 *
 * <para><b>The complex is always named.</b> Vehicle Assembly is multi-complex
 * by nature: it shows every craft the centre holds, wherever it is being built,
 * so the complex is what groups a flat list rather than a detail worth
 * suppressing when there happens to be one of them.</para>
 *
 * <para>Every control ARMS before it dispatches. A scrap moves career funds and
 * a rollback throws away a rollout that has been part-paid for, and the ui-kit
 * rule for anything in that class is that one press must not commit it. The
 * price is on the confirm wording rather than the resting one: an operator
 * scanning a list wants the names, and an operator about to spend wants the
 * number.</para>
 *
 * <para>Which controls appear is decided by the vehicle's OPERATION, not by
 * guesswork: RP-1 refuses a rollout for a vehicle already moving and refuses a
 * scrap for one on its way to a pad, so a card that offered those would be
 * offering a press that can only be refused.</para>
 */
export function VehicleCard({
  item,
  complex,
  waiting,
  pads,
  operation,
  handles,
}: Readonly<{
  item: Vehicle;
  complex: Rp1ComplexEntry | undefined;
  waiting: boolean;
  pads: readonly Rp1PadEntry[];
  operation: Rp1OperationEntry | undefined;
  handles: VehicleHandles;
}>) {
  const name = item.shipName ?? NULL_DISPLAY;
  const complexName = complex?.name ?? null;
  const label = complexName === null ? name : `${name} · ${complexName}`;
  /*
   * Narrowed to a string here rather than asserted at each control: a card with
   * no id draws none of them, and that is the only difference between the two
   * branches below.
   */
  const id = item.id ?? null;

  return (
    <ProjectCard
      badge={
        <VehicleState item={item} operation={operation} waiting={waiting} />
      }
      detail={
        <>
          {complexName === null ? null : <>{complexName} · </>}
          {/* "costs", because an unqualified number on a card is the defect
              this surface is being fixed for. It is what RP-1 has committed to
              this vehicle, which is also what a scrap of it pays back. */}
          costs <Unit value={item.cost} />
        </>
      }
      name={name}
      progress={progressOf(item, name, operation)}
      tone={settled(item, waiting, operation) ? "go" : "warning"}
    >
      <TimeLeft complex={complex} item={item} operation={operation} />
      <ComplexRate complex={complex} />

      {id === null ? (
        // Readable and not commandable, and it says which. RP-1 stamps an id on
        // every vehicle it creates, so a card without one came out of a save
        // written before it did; guessing a target from the name would pick the
        // wrong one of two vehicles that share it.
        <Text size="xs" tone="muted">
          {NULL_DISPLAY} RP-1 has no id for this vehicle
        </Text>
      ) : (
        <VehicleActions
          cost={item.cost}
          handles={handles}
          id={id}
          label={label}
          name={name}
          operation={operation}
          pads={pads}
          refusals={rolloutRefusalsOf(item)}
          rolloutBill={rolloutBillOf(item, operation)}
          waiting={waiting}
        />
      )}
    </ProjectCard>
  );
}

/**
 * The bar this card draws, or undefined when there is no work to report.
 *
 * <para>An operation OUTRANKS the build: a vehicle that has finished
 * integrating and is rolling out has a fraction for the rollout and none left
 * for the build, and drawing the build's would say the move had not
 * started.</para>
 */
function progressOf(
  item: Vehicle,
  name: string,
  operation: Rp1OperationEntry | undefined,
): Readonly<{ ratio: number | null; label: string }> | undefined {
  if (operation !== undefined) {
    if (atPad(operation)) {
      return undefined;
    }
    const what = operation.type === "Rollback" ? "Rollback" : "Rollout";
    return {
      label: `${what} progress, ${name}`,
      ratio: magnitudeOf(operation.progressRatio),
    };
  }
  const build = item as Rp1BuildItemEntry;
  if (
    build.progressRatio === undefined &&
    build.timeLeftSeconds === undefined
  ) {
    return undefined;
  }
  return {
    label: `Integration progress, ${name}`,
    ratio: magnitudeOf(build.progressRatio),
  };
}

/**
 * The clock, and what it is counting DOWN TO.
 *
 * <para>A bare "45d" is the defect this replaces: it was the only number on the
 * card with no noun, so it could equally have been how long the vehicle has
 * been queued, how long it took to build, or how long the pad is booked
 * for.</para>
 *
 * <para>Four states rather than two: an ETA, a complex with nobody on it, a
 * stall RP-1 gives no reason for, and a project RP-1 has not costed yet. The
 * staffing case is split out because it is the one an operator can fix from the
 * Space Center, and a card that reported it as a stall would send them looking
 * for a fault instead. The last is not a stall either.</para>
 */
function TimeLeft({
  item,
  complex,
  operation,
}: Readonly<{
  item: Vehicle;
  complex: Rp1ComplexEntry | undefined;
  operation: Rp1OperationEntry | undefined;
}>) {
  if (operation !== undefined) {
    if (atPad(operation)) {
      return null;
    }
    return (
      <Text size="xs" tone="muted">
        <Countdown value={operation.timeLeftSeconds} />{" "}
        {operation.type === "Rollback"
          ? "until it is back in the warehouse"
          : "until it reaches the pad"}
      </Text>
    );
  }

  const build = item as Rp1BuildItemEntry;
  // The warehouse carries neither field, so a built vehicle falls out here with
  // nothing to draw, which is right: there is no work left on it to report.
  if (
    build.progressRatio === undefined &&
    build.timeLeftSeconds === undefined
  ) {
    return null;
  }
  if (build.timeLeftSeconds !== undefined && build.timeLeftSeconds !== null) {
    return (
      <Text size="xs" tone="muted">
        <Countdown value={build.timeLeftSeconds} /> until integration finishes
      </Text>
    );
  }
  if (build.stalled === true) {
    return (
      <Text size="xs" tone="muted">
        {unstaffed(complex)
          ? `Integration cannot start: nobody is assigned to ${complex?.name ?? "this complex"}.`
          : "Integration is stalled and has no end date."}
      </Text>
    );
  }
  return (
    <Text size="xs" tone="muted">
      {NULL_DISPLAY} RP-1 has not costed this build yet.
    </Text>
  );
}

/**
 * The two things about a vehicle's complex that decide how fast its work goes.
 *
 * <para>Staffing is a RATE control rather than a capability one: RP-1 scales
 * every project inside a complex by the portion of its engineer places that are
 * filled, so a complex nobody is assigned to makes no progress at all however
 * many engineers the centre has hired. That is why the count is on the card
 * rather than only on the staffing screen: it is the answer to "why is this
 * taking so long".</para>
 *
 * <para>Rushing rides here for the same reason, and on EVERY card the complex
 * owns rather than only the ones being integrated: RP-1's rush multiplier is
 * applied to a complex's rollouts, rollbacks and reconditionings as well as its
 * integrations, so a rollout card at a rushing complex is a rushed rollout. The
 * price of rushing (the salary multiplier, and the efficiency the complex stops
 * earning) belongs beside the toggle in the Space Center; this card only has to
 * explain its own clock.</para>
 */
function ComplexRate({
  complex,
}: Readonly<{ complex: Rp1ComplexEntry | undefined }>) {
  if (complex === undefined) {
    return null;
  }
  return (
    /*
     * Wrapping, and the badge outside the sentence rather than inside it: at
     * the widget's minimum width the two together are wider than the card, and
     * a badge on a line that cannot wrap is one an operator never sees.
     */
    <Cluster gap="xs" justify="start" wrap>
      <Text size="xs" tone="muted">
        <Unit value={complex.engineers} /> /{" "}
        <Unit value={complex.maxEngineers} /> engineers
      </Text>
      {complex.isRushing === true ? (
        <Badge severity="caution">RUSHING</Badge>
      ) : null}
    </Cluster>
  );
}

/**
 * Where the vehicle is. An operation on it OUTRANKS the list it sits in: a
 * rolled-out vehicle is still in the warehouse, so "BUILT" would be true and
 * useless.
 */
function VehicleState({
  item,
  waiting,
  operation,
}: Readonly<{
  item: Vehicle;
  waiting: boolean;
  operation: Rp1OperationEntry | undefined;
}>) {
  if (operation?.type === "Rollout") {
    return atPad(operation) ? (
      <Badge severity="nominal">AT PAD</Badge>
    ) : (
      <Badge severity="caution">ROLLING OUT</Badge>
    );
  }
  if (operation?.type === "Rollback") {
    return <Badge severity="caution">ROLLING BACK</Badge>;
  }
  if (!waiting) {
    return <Badge severity="nominal">BUILT</Badge>;
  }
  if ((item as Rp1BuildItemEntry).stalled === true) {
    return <Badge severity="caution">STALLED</Badge>;
  }
  return <Badge severity="caution">INTEGRATING</Badge>;
}

/**
 * Every action available to one vehicle right NOW, as a wrapping strip of
 * buttons.
 *
 * <para>No "Actions" label in front of them. A row of arm-then-confirm buttons
 * is self-evidently the things an operator can do, and the label was taking a
 * third of the width off the controls it named.</para>
 *
 * <para><b>Nothing but buttons on the button line.</b> Every sentence
 * explaining why a control is ABSENT goes underneath, on its own line.
 * Interleaved, a refusal read as a caption belonging to the button beside it,
 * which is the one reading that is never true: it explains the button that is
 * not there.</para>
 *
 * <para>The rollout PRICE sits above the line for the mirror-image reason. It is
 * one figure for the whole move whichever pad it goes to, so a copy beside each
 * pad button would restate one price two and three times, and a single copy
 * inside the row would read as belonging to whichever button it landed
 * next to.</para>
 */
function VehicleActions({
  id,
  name,
  label,
  cost,
  rolloutBill,
  waiting,
  pads,
  refusals,
  operation,
  handles,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  cost: Rp1WarehouseItemEntry["cost"];
  rolloutBill: Rp1WarehouseItemEntry["rolloutCost"];
  waiting: boolean;
  pads: readonly Rp1PadEntry[];
  refusals: readonly string[] | undefined;
  operation: Rp1OperationEntry | undefined;
  handles: VehicleHandles;
}>) {
  const moving = operation !== undefined;
  // Rollout is offerable only to a finished vehicle that is standing still, and
  // then only if RP-1 raises no objection to the vehicle itself. Resolved once
  // here so the buttons and the sentence that replaces them cannot disagree
  // about which case this card is in.
  const rolloutOffered = !waiting && !moving && refusals === undefined;
  const eligiblePads = rolloutOffered ? eligiblePadNames(pads) : [];
  const withheld = withheldRolloutReason({
    eligiblePads,
    moving,
    pads,
    refusals,
    rolloutOffered,
    waiting,
  });

  return (
    <Stack gap="sm">
      {/* Above the buttons rather than below them, because it is what the press
          costs rather than an explanation of a press that is not offered. */}
      {(eligiblePads.length > 0 || operation?.type === "Rollback") && (
        <RolloutPrice bill={rolloutBill} />
      )}

      <Cluster gap="sm" justify="start" wrap>
        <RolloutControls
          handle={handles.rollout}
          id={id}
          label={label}
          name={name}
          padNames={eligiblePads}
        />
        {operation?.type === "Rollback" ? (
          <CommandButton
            args={{ id }}
            aria-label={`Send ${label} back out to the pad`}
            commandLabel={`Roll out ${name}`}
            confirmAriaLabel={`Confirm sending ${label} back out to the pad`}
            // COMMIT rather than spend, the same wording the facility upgrades
            // carry: nothing leaves the treasury at the press, RP-1 draws the
            // price down over the move.
            confirmLabel="Commit"
            handle={handles.rollout}
            label="Roll out again"
            size="sm"
          />
        ) : null}
        {operation?.type === "Rollout" ? (
          <CommandButton
            args={{ id }}
            aria-label={`Roll ${label} back off the pad`}
            commandLabel={`Roll back ${name}`}
            confirmAriaLabel={`Confirm rolling ${label} back off the pad`}
            confirmLabel="Confirm"
            handle={handles.rollback}
            label="Roll back"
            size="sm"
            tone="warn"
          />
        ) : null}
        {moving ? null : (
          <CommandButton
            args={{ id }}
            aria-label={`Scrap ${label}`}
            commandLabel={`Scrap ${name}`}
            confirmAriaLabel={`Confirm scrapping ${label}`}
            confirmLabel={<RefundWording cost={cost} />}
            handle={handles.scrap}
            label="Scrap"
            size="sm"
            tone="nogo"
          />
        )}
      </Cluster>

      {withheld !== null && (
        <Text size="xs" tone="muted">
          {NULL_DISPLAY} cannot roll out: {withheld}
        </Text>
      )}
    </Stack>
  );
}

/**
 * What the rollout will cost the career, beside the control that spends it.
 *
 * <para><b>"Over the rollout", the same three words the facility upgrades use,
 * and for the same reason: RP-1 takes NOTHING at the press.</b> It draws the
 * price down as the move proceeds, and a career that cannot cover a tick
 * advances by the fraction it can afford and carries on. So there is no
 * affordability verdict here and there must never be one: a shortfall makes a
 * rollout SLOWER, and "cannot afford" would describe a refusal RP-1 does not
 * make.</para>
 *
 * <para>An unpriced move still offers the control. The command reads the price
 * itself, so the worst case is a refusal one step later, against the certainty
 * of hiding a press that would have worked.</para>
 */
function RolloutPrice({
  bill,
}: Readonly<{ bill: Rp1WarehouseItemEntry["rolloutCost"] }>) {
  return (
    <Text size="xs" tone="muted">
      {bill == null ? (
        <>{NULL_DISPLAY} RP-1 has not priced this rollout</>
      ) : (
        <>
          <Unit decimals={0} value={bill} /> over the rollout
        </>
      )}
    </Text>
  );
}

/**
 * One rollout control per ELIGIBLE pad.
 *
 * <para><b>The pad is always named.</b> The command requires it, per the
 * operator's ruling: choosing a launch site is a decision an operator makes, so
 * the mod refuses rather than picking even when only one pad could have been
 * meant. The convenience belongs here instead, and this is what it looks like:
 * one pad means one button, and pressing it commits to that pad by name.</para>
 *
 * <para>Draws NOTHING when the list is empty, rather than the sentence saying
 * why. The caller owns that sentence, because it also owns the vehicle's own
 * refusals and only one of the two is worth printing; see
 * <c>withheldRolloutReason</c>.</para>
 */
function RolloutControls({
  id,
  name,
  label,
  padNames,
  handle,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  padNames: readonly string[];
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  // One pad needs no name on the button: an operator with no choice does not
  // need it repeated, and the aria-label carries it for anyone who cannot see
  // the card. The ARGS name it either way, because the command requires it.
  const short = padNames.length === 1;

  return (
    <>
      {padNames.map((padName) => (
        <CommandButton
          args={{ id, pad: padName }}
          aria-label={`Roll ${label} out to ${padName}`}
          commandLabel={`Roll ${name} out to ${padName}`}
          confirmAriaLabel={`Confirm rolling ${label} out to ${padName}`}
          // See the price above the row: the press commits the career to a bill
          // RP-1 draws down over the move, and spends nothing when it lands.
          confirmLabel="Commit"
          handle={handle}
          key={padName}
          label={short ? "Roll out" : `Roll out to ${padName}`}
          size="sm"
        />
      ))}
    </>
  );
}

/**
 * What a scrap pays back. RP-1 refunds the vehicle in FULL, integrating or
 * finished alike, which is the fact that makes this control safe to offer and
 * expensive to press by accident: getting the vehicle back means paying for the
 * integration time again.
 */
function RefundWording({
  cost,
}: Readonly<{ cost: Rp1WarehouseItemEntry["cost"] }>) {
  return (
    <>
      Refund <Unit value={cost} />
    </>
  );
}
