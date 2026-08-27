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
                freePads={freePads(pads, item.lcId)}
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
                freePads={freePads(pads, item.lcId)}
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
  freePads: free,
  operation,
  handles,
}: Readonly<{
  item: Rp1BuildItemEntry | Rp1WarehouseItemEntry;
  complexName: string | null;
  finished: boolean;
  freePads: readonly string[];
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
                freePads={free}
                handles={handles}
                id={id}
                label={label}
                name={name}
                operation={operation}
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
  freePads: free,
  operation,
  handles,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  cost: Rp1WarehouseItemEntry["cost"];
  finished: boolean;
  freePads: readonly string[];
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
        <RolloutControls
          freePads={free}
          handle={handles.rollout}
          id={id}
          label={label}
          name={name}
        />
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
 * The rollout control, or one per free pad when the operator has a choice to
 * make.
 *
 * <para>The mod takes the pad by name and REFUSES an ambiguous omission rather
 * than picking one, because RP-1's own rollout asks with a popup and there is
 * nobody to answer a popup on a command from another machine. So a complex with
 * one usable pad gets one button and no decision, and a complex with several
 * gets the decision made here, where the operator can see the names, instead of
 * as a refusal they have to read and retry.</para>
 *
 * <para>No free pad at all still draws ONE button. The refusal says which of
 * four things is wrong with the pads (destroyed, unbuilt, reconditioning, or a
 * vehicle already there), and those are four different next moves; a control
 * that simply vanished would say none of them.</para>
 */
function RolloutControls({
  id,
  name,
  label,
  freePads,
  handle,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  freePads: readonly string[];
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  if (freePads.length > 1) {
    return (
      <>
        {freePads.map((pad) => (
          <CommandButton
            args={{ id, pad }}
            aria-label={`Roll ${label} out to ${pad}`}
            commandLabel={`Roll ${name} out to ${pad}`}
            confirmAriaLabel={`Confirm rolling ${label} out to ${pad}`}
            confirmLabel="Confirm"
            handle={handle}
            key={pad}
            label={`Roll out to ${pad}`}
            size="sm"
          />
        ))}
      </>
    );
  }

  return (
    <CommandButton
      args={{ id }}
      aria-label={`Roll ${label} out to the pad`}
      commandLabel={`Roll out ${name}`}
      confirmAriaLabel={`Confirm rolling ${label} out to the pad`}
      confirmLabel="Confirm"
      handle={handle}
      label="Roll out"
      size="sm"
    />
  );
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
 * The pads at this complex an operator could roll out to, by name.
 *
 * <para>"Free" and nothing else, which is RP-1's own rule: any other state means
 * a launch aimed there will not work. The names go on the buttons, so this is
 * the whole of what the widget needs from the pad Topic.</para>
 */
function freePads(
  pads: readonly Rp1PadEntry[] | undefined,
  lcId: string | undefined | null,
): readonly string[] {
  if (lcId === undefined || lcId === null) {
    return [];
  }
  const names: string[] = [];
  for (const pad of pads ?? []) {
    if (pad.lcId === lcId && pad.state === "Free" && pad.name) {
      names.push(pad.name);
    }
  }
  return names;
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
