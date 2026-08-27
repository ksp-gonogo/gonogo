import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  CommandButton,
  Countdown,
  Inline,
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
import type {
  Rp1BuildItemEntry,
  Rp1ComplexEntry,
  Rp1OperationEntry,
  Rp1PadEntry,
  Rp1WarehouseItemEntry,
} from "../__generated__/contract";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the consumer
// that would silently receive bare numbers without it.
import "../topics";

/** Build another copy of a design. Must match `Rp1BuildCommands.RepeatCommand`. */
export const RP1_BUILD_REPEAT_COMMAND = "rp1.build.repeat";

/** Move a finished vehicle to a pad. Must match `Rp1VehicleCommands.RolloutCommand`. */
export const RP1_ROLLOUT_COMMAND = "rp1.vehicle.rollout";

/** Bring it back off the pad. Must match `Rp1VehicleCommands.RollbackCommand`. */
export const RP1_ROLLBACK_COMMAND = "rp1.vehicle.rollback";

/** Take a vehicle off the queue, for a refund. Must match `Rp1VehicleCommands.ScrapCommand`. */
export const RP1_SCRAP_COMMAND = "rp1.vehicle.scrap";

/** Rush a whole complex. Must match `Rp1VehicleCommands.RushCommand`. */
export const RP1_COMPLEX_RUSH_COMMAND = "rp1.complex.rush";

/**
 * Every vehicle RP-1's space centre holds, and every action an operator takes on
 * one: build another, move it to a pad, bring it back, or scrap it.
 *
 * <para><b>Why these are the actions worth controls.</b> Under RP-1 a rocket is
 * a DESIGN that a launch complex integrates into an article, and the career loop
 * is to design once and fly the same vehicle many times. So "another one of
 * these" is the most repeated decision in the game, and moving the article that
 * comes out is the step between having a rocket and being able to launch it.
 * Until this widget existed the whole RP-1 surface was read-only: an operator
 * could watch a complex integrate and could not ask it to start, move or cancel
 * anything.</para>
 *
 * <para><b>Both lists, one section.</b> A finished vehicle in the warehouse and
 * one still integrating are different states of the same question, and RP-1's
 * own window draws the same Duplicate button on both. The warehouse comes first
 * because a design worth repeating is usually one that finished, and because
 * only a finished vehicle can be rolled out.</para>
 *
 * <para>The funds balance sits at the top because most controls below it spend:
 * an operator deciding whether to start another should not have to look at a
 * different widget to see what is left. It is the balance the mod's own
 * affordability check will be run against, so a refusal here quotes the same
 * number the operator is reading. A rollout is the one spend that is billed as
 * it progresses rather than up front, and a scrap PAYS the career, but the
 * balance is what an operator judges all three against.</para>
 */
export function KscVehicles() {
  const available = current(useTelemetry("rp1.available"));
  const warehouse = current(useTelemetry("rp1.warehouse"));
  const queue = current(useTelemetry("rp1.buildQueue"));
  const complexes = current(useTelemetry("rp1.complexes"));
  const pads = current(useTelemetry("rp1.pads"));
  const operations = current(useTelemetry("rp1.operations"));
  const career = current(useTelemetry("career.status"));

  // Unconditional, and above the early return on purpose: a hook after it would
  // change count on the first frame RP-1 answers.
  const repeat = useCommand(RP1_BUILD_REPEAT_COMMAND);
  const rollout = useCommand(RP1_ROLLOUT_COMMAND);
  const rollback = useCommand(RP1_ROLLBACK_COMMAND);
  const scrap = useCommand(RP1_SCRAP_COMMAND);
  const rush = useCommand(RP1_COMPLEX_RUSH_COMMAND);
  usePanelDelay(repeat);
  usePanelDelay(rollout);
  usePanelDelay(rollback);
  usePanelDelay(scrap);
  usePanelDelay(rush);

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  const built = warehouse ?? [];
  const building = queue ?? [];
  const complexList = complexes ?? [];
  // Only worth naming a complex when the centre has more than one, the same rule
  // KscConstruction applies to centres.
  const nameComplex = complexList.length > 1;
  const handles = { repeat, rollout, rollback, scrap };

  return (
    <Section>
      <SectionTitle>RP-1 VEHICLES</SectionTitle>
      <Stack as="ul" gap="sm" style={LIST_STYLE}>
        <Row>
          <RowName>Funds</RowName>
          <Text>
            <Unit value={career?.economy?.funds} />
          </Text>
        </Row>

        {built.length === 0 && building.length === 0 ? (
          <Row>
            <RowName>Vehicles</RowName>
            {/* A real answer, and one worth stating: an empty space centre and
                an Uplink that is not reporting look identical if this row is
                simply left out. */}
            <Text>none built and none on order</Text>
          </Row>
        ) : (
          <>
            {built.map((item) => (
              <VehicleRow
                complexName={complexName(complexList, item.lcId, nameComplex)}
                finished
                pads={padsAt(pads, item.lcId)}
                handles={handles}
                item={item}
                key={rowKey(item)}
                operation={operationFor(operations, item)}
              />
            ))}
            {building.map((item) => (
              <VehicleRow
                complexName={complexName(complexList, item.lcId, nameComplex)}
                finished={false}
                pads={padsAt(pads, item.lcId)}
                handles={handles}
                item={item}
                key={rowKey(item)}
                operation={operationFor(operations, item)}
              />
            ))}
          </>
        )}

        {complexList.map((complex) => (
          <ComplexRush
            complex={complex}
            handle={rush}
            key={complex.lcId ?? complex.name ?? ""}
            named={nameComplex}
          />
        ))}
      </Stack>
    </Section>
  );
}

/** The four command handles a vehicle row can dispatch. */
type VehicleHandles = Readonly<{
  repeat: Parameters<typeof CommandButton>[0]["handle"];
  rollout: Parameters<typeof CommandButton>[0]["handle"];
  rollback: Parameters<typeof CommandButton>[0]["handle"];
  scrap: Parameters<typeof CommandButton>[0]["handle"];
}>;

/**
 * One vehicle, its state, and every action available to it right now.
 *
 * <para>Every control ARMS before it dispatches. Three of the four move career
 * funds and the fourth throws away a rollout that has been part-paid for, and
 * the ui-kit rule for anything in that class is that one press must not commit
 * it. The price is on the confirm wording rather than the resting one: an
 * operator scanning a list wants the names, and an operator about to spend wants
 * the number.</para>
 *
 * <para>Which controls appear is decided by the vehicle's OPERATION, not by
 * guesswork: RP-1 refuses a rollout for a vehicle already moving and refuses a
 * scrap for one on its way to a pad, so a row that offered those would be
 * offering a press that can only be refused.</para>
 */
function VehicleRow({
  item,
  complexName: complex,
  finished,
  pads,
  operation,
  handles,
}: Readonly<{
  item: Rp1BuildItemEntry | Rp1WarehouseItemEntry;
  complexName: string | null;
  finished: boolean;
  pads: readonly Rp1PadEntry[];
  operation: Rp1OperationEntry | undefined;
  handles: VehicleHandles;
}>) {
  const name = item.shipName ?? NULL_DISPLAY;
  const label = complex === null ? name : `${name} · ${complex}`;
  // Narrowed to a string here rather than asserted at each control: a row with
  // no id draws none of them, and that is the only difference between the two
  // branches below.
  const id = item.id ?? null;

  return (
    <Stack as="li" gap="xs">
      {/* A Row renders an <li>, so these need their own list around them or a
          screen reader is handed orphan list items inside this one. */}
      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        <Row>
          <RowName>{label}</RowName>
          <Text>
            <VehicleState
              finished={finished}
              item={item}
              operation={operation}
            />
          </Text>
        </Row>
        <Row>
          <RowName>Cost</RowName>
          <Text>
            <Unit value={item.cost} />
          </Text>
        </Row>
        <Row>
          <RowName>Actions</RowName>
          <Text>
            {id === null ? (
              // Readable and not commandable, and it says which. RP-1 stamps an
              // id on every vehicle it creates, so a row without one came out of
              // a save written before it did; guessing a target from the name
              // would pick the wrong one of two vehicles that share it.
              <>{NULL_DISPLAY} RP-1 has no id for this vehicle</>
            ) : (
              <VehicleActions
                cost={item.cost}
                finished={finished}
                handles={handles}
                id={id}
                label={label}
                name={name}
                operation={operation}
                pads={pads}
                refusals={rolloutRefusalsOf(item)}
              />
            )}
          </Text>
        </Row>
      </Stack>
    </Stack>
  );
}

/**
 * Every action available to one vehicle right NOW.
 *
 * <para>Which controls appear is decided by the vehicle's OPERATION, not by
 * guesswork: RP-1 refuses a rollout for a vehicle already moving and refuses a
 * scrap for one on its way to a pad, so a row that offered those would be
 * offering a press that can only be refused.</para>
 */
function VehicleActions({
  id,
  name,
  label,
  cost,
  finished,
  pads,
  refusals,
  operation,
  handles,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  cost: Rp1WarehouseItemEntry["cost"];
  finished: boolean;
  pads: readonly Rp1PadEntry[];
  refusals: readonly string[] | undefined;
  operation: Rp1OperationEntry | undefined;
  handles: VehicleHandles;
}>) {
  const moving = operation !== undefined;

  return (
    <Inline gap="xs">
      <CommandButton
        args={{ id }}
        aria-label={`Build another ${label}`}
        commandLabel={`Build another ${name}`}
        confirmAriaLabel={`Confirm building another ${label}`}
        confirmLabel={<SpendWording cost={cost} />}
        handle={handles.repeat}
        label="Build"
        size="sm"
      />
      {finished && !moving ? (
        refusals === undefined ? (
          <RolloutControls
            handle={handles.rollout}
            id={id}
            label={label}
            name={name}
            pads={pads}
          />
        ) : (
          // RP-1's own reasons, in RP-1's own words. The VEHICLE half of
          // eligibility, and it outranks the pads entirely: no pad at this
          // complex can take a vehicle its complex will not release, so offering
          // a pad button would offer a press that can only be refused.
          <Text>
            {NULL_DISPLAY} {refusals.join("; ")}
          </Text>
        )
      ) : null}
      {operation?.type === "Rollback" ? (
        <CommandButton
          args={{ id }}
          aria-label={`Send ${label} back out to the pad`}
          commandLabel={`Roll out ${name}`}
          confirmAriaLabel={`Confirm sending ${label} back out to the pad`}
          confirmLabel="Confirm"
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
    </Inline>
  );
}

/**
 * One rollout control per ELIGIBLE pad, and a plain sentence when there are
 * none.
 *
 * <para><b>The pad is always named.</b> The command requires it, per the
 * operator's ruling: choosing a launch site is a decision an operator makes, so
 * the mod refuses rather than picking even when only one pad could have been
 * meant. The convenience belongs here instead, and this is what it looks like:
 * one pad means one button, and pressing it commits to that pad by name.</para>
 *
 * <para><b>Eligibility comes off the wire, not from a rule reproduced here.</b>
 * A pad is offerable when RP-1 says its state is Free AND that no craft is
 * standing on it, and those are two separate facts because
 * <c>state</c> cannot see the second: a vehicle already sent to the launch site
 * has no operation left on the pad, so the pad still reads Free. The vehicle's
 * own half arrives as <c>rolloutRefusals</c> and is handled by the caller,
 * because it is the same answer for every pad the complex owns.</para>
 *
 * <para>No eligible pad draws a SENTENCE rather than a disabled button, and says
 * which pad is in the way where the wire named it. A control that simply
 * vanished would leave an operator with nothing to act on, and "the pad is
 * taken" without the name leaves them looking.</para>
 */
function RolloutControls({
  id,
  name,
  label,
  pads,
  handle,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  pads: readonly Rp1PadEntry[];
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const eligible = eligiblePadNames(pads);

  if (eligible.length === 0) {
    return (
      <Text>
        {NULL_DISPLAY} {noPadReason(pads)}
      </Text>
    );
  }

  // One pad needs no name on the button: an operator with no choice does not
  // need it repeated, and the aria-label carries it for anyone who cannot see
  // the row. The ARGS name it either way, because the command requires it.
  const short = eligible.length === 1;

  return (
    <>
      {eligible.map((padName) => (
        <CommandButton
          args={{ id, pad: padName }}
          aria-label={`Roll ${label} out to ${padName}`}
          commandLabel={`Roll ${name} out to ${padName}`}
          confirmAriaLabel={`Confirm rolling ${label} out to ${padName}`}
          confirmLabel="Confirm"
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
 * The names of the pads a rollout could actually go to: RP-1 calls them Free and
 * nothing is standing on them.
 *
 * <para><c>hasVesselWaiting</c> is checked for TRUE rather than for falsiness.
 * Null means the mod could not answer, and treating that as "occupied" would
 * hide a working control; the command re-checks at the press, so the worst case
 * of offering it is a refusal one step later.</para>
 *
 * <para>Returns NAMES rather than pads because the name is the whole of what a
 * rollout needs, and reading it here is what lets the caller pass it without an
 * assertion: a pad RP-1 gave no name to cannot be commanded at all.</para>
 */
function eligiblePadNames(pads: readonly Rp1PadEntry[]): readonly string[] {
  const names: string[] = [];
  for (const pad of pads) {
    const name = pad.name;
    if (
      name !== undefined &&
      name !== null &&
      name !== "" &&
      pad.state === "Free" &&
      pad.hasVesselWaiting !== true
    ) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Why no pad can take this vehicle, in the terms an operator acts on. Four
 * different next moves hide behind RP-1's pad states: repair it, build it, wait
 * for reconditioning, or move the vehicle already there.
 */
function noPadReason(pads: readonly Rp1PadEntry[]): string {
  if (pads.length === 0) {
    return "this complex has no pads";
  }
  const occupied = pads.find((p) => p.hasVesselWaiting === true);
  if (occupied !== undefined) {
    const who = occupied.waitingVesselName ?? "another vessel";
    return `${who} is on ${occupied.name ?? "the pad"}, waiting to launch`;
  }
  if (pads.some((p) => p.state === "Reconditioning")) {
    return "the pad is being reconditioned after a launch";
  }
  if (pads.some((p) => p.state === "Destroyed")) {
    return "the pad is destroyed and needs repairing";
  }
  if (pads.some((p) => p.state === "Nonoperational")) {
    return "the pad has not been built yet";
  }
  return "no pad is free";
}

/**
 * Where the vehicle is. An operation on it OUTRANKS the list it sits in: a
 * rolled-out vehicle is still in the warehouse, so "BUILT" would be true and
 * useless.
 */
function VehicleState({
  item,
  finished,
  operation,
}: Readonly<{
  item: Rp1BuildItemEntry | Rp1WarehouseItemEntry;
  finished: boolean;
  operation: Rp1OperationEntry | undefined;
}>) {
  if (operation?.type === "Rollout") {
    return atPad(operation) ? (
      <Badge severity="nominal">AT PAD</Badge>
    ) : (
      <>
        <Badge severity="caution">ROLLING OUT</Badge>{" "}
        <OperationEta operation={operation} />
      </>
    );
  }
  if (operation?.type === "Rollback") {
    return (
      <>
        <Badge severity="caution">ROLLING BACK</Badge>{" "}
        <OperationEta operation={operation} />
      </>
    );
  }
  if (finished) {
    return <Badge severity="nominal">BUILT</Badge>;
  }
  return <Integrating item={item as Rp1BuildItemEntry} />;
}

/** An operation's ETA where it has one, and nothing where RP-1 has not costed it. */
function OperationEta({
  operation,
}: Readonly<{ operation: Rp1OperationEntry }>) {
  if (
    operation.timeLeftSeconds === undefined ||
    operation.timeLeftSeconds === null
  ) {
    return null;
  }
  return <Countdown value={operation.timeLeftSeconds} />;
}

/**
 * What the confirm press commits to. The price is RP-1's stored figure rather
 * than the charge, and the difference is real: leaders and strategies move what
 * a purchase costs and only the mod can evaluate that, so this is an estimate
 * and the refusal that quotes the true charge is authoritative over it.
 */
function SpendWording({
  cost,
}: Readonly<{ cost: Rp1WarehouseItemEntry["cost"] }>) {
  return (
    <>
      Spend <Unit value={cost} />
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

/**
 * A launch complex's rush mode.
 *
 * <para>Per COMPLEX and not per vehicle, which is a fact about RP-1 rather than
 * a simplification here: <c>IsRushing</c> is a bool on the launch complex, so
 * every project inside it is rushed together. A control shaped like "rush this
 * build" would be a lie about what the game does.</para>
 *
 * <para>One press, unlike every control above it, and the difference is real:
 * this spends nothing at the moment it lands. It raises the rate and the SALARY
 * multiplier, so the cost arrives later as payroll, and it is reversed by
 * pressing again. The label says what the press will do rather than what the
 * state is, because a button that reads as its own state is one an operator
 * presses to confirm what they are looking at.</para>
 */
function ComplexRush({
  complex,
  named,
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
  named: boolean;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const lcId = complex.lcId;
  if (lcId === undefined || lcId === null) {
    return null;
  }
  const name = complex.name ?? "this complex";
  const rushing = complex.isRushing === true;

  return (
    <Row>
      <RowName>{named ? `${name} rush` : "Rush integration"}</RowName>
      <Text>
        <Inline gap="xs">
          {rushing ? <Badge severity="caution">RUSHING</Badge> : null}
          <CommandButton
            active={rushing}
            args={{ lcId, rushing: !rushing }}
            aria-label={
              rushing
                ? `Stop rushing work at ${name}`
                : `Rush work at ${name}, at a higher salary`
            }
            commandLabel={rushing ? `Stop rushing ${name}` : `Rush ${name}`}
            handle={handle}
            label={rushing ? "Stop rushing" : "Rush"}
            size="sm"
            tone={rushing ? "warn" : "neutral"}
          />
        </Inline>
      </Text>
    </Row>
  );
}

/**
 * How far along a vehicle still on the build list is. Three states rather than
 * two, the same split LaunchComplexStatus draws: an ETA, a rate RP-1 resolved at
 * zero, and a project RP-1 has not costed yet. The last is not a stall.
 */
function Integrating({ item }: Readonly<{ item: Rp1BuildItemEntry }>) {
  if (item.timeLeftSeconds !== undefined && item.timeLeftSeconds !== null) {
    return (
      <>
        <Badge severity="caution">INTEGRATING</Badge>{" "}
        <Countdown value={item.timeLeftSeconds} />
      </>
    );
  }
  if (item.stalled === true) {
    return <Badge severity="caution">STALLED</Badge>;
  }
  return (
    <>
      <Badge severity="caution">INTEGRATING</Badge> {NULL_DISPLAY} not costed
      yet
    </>
  );
}

/**
 * The rollout or rollback moving this vehicle, or undefined.
 *
 * <para>Joined on <c>shipId</c>, which is a DIFFERENT id from the <c>id</c> a
 * command addresses: RP-1 stamps an operation's <c>associatedID</c> from
 * <c>shipID</c>, and the two ids live on the same vehicle for exactly this
 * reason. A vehicle with no <c>shipId</c> comes back as not moving, which is
 * the safe direction: the mod refuses a second rollout itself, so the worst case
 * is a control that can only be refused rather than one that acts twice.</para>
 *
 * <para>Reconditioning and recovery are deliberately not matched. A
 * reconditioning belongs to a PAD and carries the pad's id, and a recovery is a
 * flight-scene operation with no control on this widget.</para>
 */
function operationFor(
  operations: readonly Rp1OperationEntry[] | undefined,
  item: Rp1BuildItemEntry | Rp1WarehouseItemEntry,
): Rp1OperationEntry | undefined {
  const shipId = item.shipId;
  if (shipId === undefined || shipId === null) {
    return undefined;
  }
  return (operations ?? []).find(
    (operation) =>
      operation.associatedVesselId === shipId &&
      operation.lcId === item.lcId &&
      (operation.type === "Rollout" || operation.type === "Rollback"),
  );
}

/**
 * Whether a rollout has finished, so the vehicle is standing on the pad rather
 * than moving to it. An unreadable fraction reads as still moving: RP-1 leaves
 * it absent on an uncosted project, and claiming a vehicle had ARRIVED on that
 * basis is the one wrong answer an operator would act on.
 */
function atPad(operation: Rp1OperationEntry): boolean {
  return (magnitudeOf(operation.progressRatio) ?? 0) >= 1;
}

/**
 * Every pad at this complex, eligible or not.
 *
 * <para>All of them rather than only the usable ones, because the UNUSABLE ones
 * carry the reason. A widget handed only the free pads can draw the buttons and
 * cannot say why there are none.</para>
 */
function padsAt(
  pads: readonly Rp1PadEntry[] | undefined,
  lcId: string | undefined | null,
): readonly Rp1PadEntry[] {
  if (lcId === undefined || lcId === null) {
    return [];
  }
  return (pads ?? []).filter((pad) => pad.lcId === lcId);
}

/**
 * RP-1's reasons this vehicle cannot leave its complex, or undefined when it has
 * none.
 *
 * <para>Only the warehouse carries them: a vehicle still integrating cannot roll
 * out for a reason that has nothing to do with its envelope, so the mod
 * deliberately publishes none for it, and `in` rather than a cast is what
 * distinguishes "no objection" from "not that kind of row".</para>
 */
function rolloutRefusalsOf(
  item: Rp1BuildItemEntry | Rp1WarehouseItemEntry,
): readonly string[] | undefined {
  const refusals = (item as Rp1WarehouseItemEntry).rolloutRefusals;
  return refusals === undefined || refusals === null || refusals.length === 0
    ? undefined
    : refusals;
}

/** The complex's own name, or null when there is only one and naming it says nothing. */
function complexName(
  complexes: readonly Rp1ComplexEntry[],
  lcId: string | undefined | null,
  wanted: boolean,
): string | null {
  if (!wanted || lcId === undefined || lcId === null) {
    return null;
  }
  return complexes.find((c) => c.lcId === lcId)?.name ?? null;
}

/**
 * A stable key. RP-1's own id where there is one, because two vehicles of the
 * same design at the same complex are the point of this widget and would
 * otherwise share a key.
 */
function rowKey(item: Rp1BuildItemEntry | Rp1WarehouseItemEntry): string {
  return item.id ?? `${item.lcId ?? ""}:${item.shipName ?? ""}`;
}

/**
 * A Row renders an `<li>`, so its rows need list semantics around them; see
 * LaunchComplexStatus for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;

/** The value where one is current; see LaunchComplexStatus for why reckonable counts. */
function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

registerAugment({
  id: "rp1-ksc-vehicles",
  augments: "space-center-status.sections",
  component: KscVehicles,
  owner: RP1,
});
