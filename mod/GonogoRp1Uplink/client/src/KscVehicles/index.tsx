import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  CommandButton,
  Countdown,
  Inline,
  magnitudeOf,
  NULL_DISPLAY,
  ProgressBar,
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
 * Every vehicle RP-1's space centre holds, and every action an operator takes
 * here: move one to a pad, bring it back, scrap it, or order another copy of a
 * design the centre already holds.
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
 * <para><b>The repeat is one control per DESIGN, below both lists, and not a
 * button on every card.</b> On a card it read as "build", which this surface
 * cannot do: the only build command RP-1 exposes copies something the centre
 * already holds, so an operator was offered a second Atlas on a card and had no
 * way to order a first one anywhere. Named for what it repeats and stood apart
 * from the vehicles it repeats, it stops claiming to be the general case. There
 * is no control for building a design the centre has never built, because there
 * is no command for it.</para>
 *
 * <para><b>Two lists, drawn as two.</b> RP-1 holds a vehicle in the warehouse or
 * on the build list, never both, and the two answer different questions: what
 * can fly, and what is being made. Interleaving them left every vehicle carrying
 * the same set of controls with only a badge to say which of them could actually
 * be pressed. Split, the section a card sits in already says most of that, and
 * the badge only has to carry what is left.</para>
 *
 * <para><b>A card per vehicle, not a run of rows.</b> A vehicle is a name, a
 * complex, a state, a cost and up to four controls, and as label/value rows
 * those five facts read as five unrelated rows with nothing tying them to the
 * vehicle above or below. Two vehicles of the same design at the same complex is
 * the case this widget exists for and the case a flat list cannot express at
 * all.</para>
 *
 * <para><b>No funds row here.</b> Every control below spends or refunds, and the
 * balance an operator judges them against is the host widget's, drawn once in
 * its header. Three augments each carrying their own copy is the same rule
 * satisfied three times in one widget, which reads as a defect rather than as
 * care.</para>
 */
export function KscVehicles() {
  const available = current(useTelemetry("rp1.available"));
  const warehouse = current(useTelemetry("rp1.warehouse"));
  const queue = current(useTelemetry("rp1.buildQueue"));
  const complexes = current(useTelemetry("rp1.complexes"));
  const pads = current(useTelemetry("rp1.pads"));
  const operations = current(useTelemetry("rp1.operations"));

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
  // Only worth naming a complex on a vehicle when the centre has more than one,
  // the same rule KscConstruction applies to centres. The complex list below
  // names them either way, because there the name is the row.
  const nameComplex = complexList.length > 1;
  const handles = { rollout, rollback, scrap };

  return (
    // A step wider than a section of rows, because this one's children are
    // GROUPS: at the tightest gap "VEHICLES" sat as close to "Warehouse" as
    // "Warehouse" sat to its own cards, so nothing said which heading owned
    // which.
    <Section gap="lg">
      <SectionTitle>VEHICLES</SectionTitle>

      {built.length === 0 && building.length === 0 ? (
        // A real answer, and one worth stating: an empty space centre and an
        // Uplink that is not reporting look identical if this is left out.
        <Text size="sm" tone="muted">
          None built and none on order.
        </Text>
      ) : (
        <>
          <VehicleGroup
            complexes={complexList}
            handles={handles}
            items={built}
            nameComplex={nameComplex}
            operations={operations}
            pads={pads}
            title="Warehouse"
            waiting={false}
          />
          <VehicleGroup
            complexes={complexList}
            handles={handles}
            items={building}
            nameComplex={nameComplex}
            operations={operations}
            pads={pads}
            title="Building"
            waiting
          />
          <RepeatBuilds
            designs={repeatableDesigns(
              [built, building],
              complexList,
              nameComplex,
            )}
            handle={repeat}
          />
        </>
      )}

      {complexList.length > 0 && (
        <Stack gap="xs">
          <SectionTitle>Launch complexes</SectionTitle>
          <Stack as="ul" gap="xs" style={LIST_STYLE}>
            {complexList.map((complex) => (
              <ComplexRush
                complex={complex}
                handle={rush}
                key={complex.lcId ?? complex.name ?? ""}
              />
            ))}
          </Stack>
        </Stack>
      )}
    </Section>
  );
}

/** The three command handles a vehicle card can dispatch. */
type VehicleHandles = Readonly<{
  rollout: Parameters<typeof CommandButton>[0]["handle"];
  rollback: Parameters<typeof CommandButton>[0]["handle"];
  scrap: Parameters<typeof CommandButton>[0]["handle"];
}>;

/**
 * One of RP-1's two vehicle lists, headed by what it is.
 *
 * <para>The heading is deliberately QUIETER than the section's own: a
 * second full-weight title stacked directly under "Vehicles" reads as two
 * sections rather than as one split in two, which is the opposite of what the
 * split is for.</para>
 *
 * <para>An empty list draws nothing at all rather than an empty heading: the
 * other list's heading already tells an operator which of the two they are
 * looking at, and a career with nothing on order should not be handed a
 * paragraph saying so twice.</para>
 */
function VehicleGroup({
  title,
  items,
  waiting,
  complexes,
  pads,
  operations,
  nameComplex,
  handles,
}: Readonly<{
  title: string;
  items: readonly (Rp1BuildItemEntry | Rp1WarehouseItemEntry)[];
  waiting: boolean;
  complexes: readonly Rp1ComplexEntry[];
  pads: readonly Rp1PadEntry[] | undefined;
  operations: readonly Rp1OperationEntry[] | undefined;
  nameComplex: boolean;
  handles: VehicleHandles;
}>) {
  if (items.length === 0) {
    return null;
  }

  return (
    // Its own stack, at the tight gap, so the heading belongs to the cards
    // under it rather than floating between two groups spaced the same.
    <Stack gap="xs">
      <Text size="xs" tone="muted">
        {title}
      </Text>
      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        {items.map((item) => (
          <VehicleCard
            complexName={complexName(complexes, item.lcId, nameComplex)}
            handles={handles}
            item={item}
            key={rowKey(item)}
            operation={operationFor(operations, item)}
            pads={padsAt(pads, item.lcId)}
            waiting={waiting}
          />
        ))}
      </Stack>
    </Stack>
  );
}

/** One design RP-1 can be asked for another copy of. */
type RepeatableDesign = Readonly<{
  /** The vehicle the command is addressed to, one existing copy of the design. */
  id: string;
  name: string;
  /** The name, with its complex where the centre has more than one. */
  label: string;
  cost: Rp1WarehouseItemEntry["cost"];
}>;

/**
 * The repeat controls, one per design, under both lists.
 *
 * <para>Named for the design each one copies, because the name is the whole of
 * what distinguishes them and a strip of buttons all reading "Build another"
 * would be four presses an operator cannot tell apart.</para>
 *
 * <para>The heading says REPEAT rather than build. RP-1 has no command for
 * building a design the centre has never held, so a heading saying "build"
 * would promise the one thing this surface cannot do.</para>
 */
function RepeatBuilds({
  designs,
  handle,
}: Readonly<{
  designs: readonly RepeatableDesign[];
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  if (designs.length === 0) {
    return null;
  }

  return (
    <Stack gap="xs">
      <Text size="xs" tone="muted">
        Repeat a build
      </Text>
      <Cluster gap="xs" justify="start" wrap>
        {designs.map((design) => (
          <CommandButton
            args={{ id: design.id }}
            aria-label={`Build another ${design.label}`}
            commandLabel={`Build another ${design.name}`}
            confirmAriaLabel={`Confirm building another ${design.label}`}
            confirmLabel={<SpendWording cost={design.cost} />}
            handle={handle}
            key={design.id}
            label={`Build another ${design.name}`}
            size="sm"
          />
        ))}
      </Cluster>
    </Stack>
  );
}

/**
 * Every design the centre could be asked for another copy of, once each.
 *
 * <para>Collapsed by complex and name, because that pair IS the design here:
 * two Atlases at LC-1 are the same craft file built twice, and offering a
 * control per copy asked an operator to choose between two presses that do the
 * same thing. The command is still addressed to a vehicle id, so one existing
 * copy is carried as the target, and a finished one is preferred over a queued
 * one only because the warehouse list is read first.</para>
 *
 * <para>A vehicle RP-1 gave no id to is skipped, for the reason its card gives:
 * the name would have to be guessed back into an id. One with no NAME is
 * skipped too, because a button reading "Build another {NULL_DISPLAY}" names
 * nothing an operator could choose between.</para>
 */
function repeatableDesigns(
  lists: readonly (readonly (Rp1BuildItemEntry | Rp1WarehouseItemEntry)[])[],
  complexes: readonly Rp1ComplexEntry[],
  nameComplex: boolean,
): readonly RepeatableDesign[] {
  const designs = new Map<string, RepeatableDesign>();
  for (const list of lists) {
    for (const item of list) {
      const id = item.id;
      const name = item.shipName;
      if (
        id === undefined ||
        id === null ||
        name === undefined ||
        name === null ||
        name === ""
      ) {
        continue;
      }
      const key = `${item.lcId ?? ""}:${name}`;
      if (designs.has(key)) {
        continue;
      }
      const complex = complexName(complexes, item.lcId, nameComplex);
      designs.set(key, {
        cost: item.cost,
        id,
        label: complex === null ? name : `${name} · ${complex}`,
        name,
      });
    }
  }
  return [...designs.values()];
}

/**
 * One vehicle: what it is, where it has got to, what it cost, and every action
 * that acts on THIS copy of it. Ordering another copy is not one of them; it is
 * a design-level control and lives under both lists.
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
function VehicleCard({
  item,
  complexName: complex,
  waiting,
  pads,
  operation,
  handles,
}: Readonly<{
  item: Rp1BuildItemEntry | Rp1WarehouseItemEntry;
  complexName: string | null;
  waiting: boolean;
  pads: readonly Rp1PadEntry[];
  operation: Rp1OperationEntry | undefined;
  handles: VehicleHandles;
}>) {
  const name = item.shipName ?? NULL_DISPLAY;
  const label = complex === null ? name : `${name} · ${complex}`;
  // Narrowed to a string here rather than asserted at each control: a card with
  // no id draws none of them, and that is the only difference between the two
  // branches below.
  const id = item.id ?? null;

  return (
    // The accent rule repeats the badge as colour, so a card's state survives a
    // glance that never reaches the badge, and it is read off the same state the
    // badge is: driving it from the LIST would paint a vehicle mid-rollout as
    // settled, because a rolled-out vehicle is still a warehouse one.
    <Card as="li" tone={settled(item, waiting, operation) ? "go" : "warning"}>
      <Stack gap="xs">
        <Cluster gap="sm">
          <RowName>{name}</RowName>
          <VehicleState item={item} operation={operation} waiting={waiting} />
        </Cluster>

        <Text size="xs" tone="muted">
          {complex === null ? null : <>{complex} · </>}
          {/* "costs", because an unqualified number on a card is the defect this
              surface is being fixed for. It is one figure doing two jobs and
              both are true of a vehicle in either list: what another copy is
              priced at, and what a scrap of this one pays back. */}
          costs <Unit value={item.cost} />
        </Text>

        <VehicleProgress item={item} label={name} operation={operation} />

        {id === null ? (
          // Readable and not commandable, and it says which. RP-1 stamps an
          // id on every vehicle it creates, so a card without one came out of
          // a save written before it did; guessing a target from the name
          // would pick the wrong one of two vehicles that share it.
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
            waiting={waiting}
          />
        )}
      </Stack>
    </Card>
  );
}

/**
 * Every action available to one vehicle right NOW, as a wrapping strip of
 * buttons.
 *
 * <para>No "Actions" label in front of them. A row of arm-then-confirm buttons
 * is self-evidently the things an operator can do, and the label was taking a
 * third of the width off the controls it named.</para>
 *
 * <para><b>Nothing but buttons on the button line.</b> Every sentence explaining
 * why a control is ABSENT goes underneath, on its own line. Interleaved, a
 * refusal read as a caption belonging to the button beside it, which is the one
 * reading that is never true: it explains the button that is not there.</para>
 */
function VehicleActions({
  id,
  name,
  label,
  cost,
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
    pads,
    refusals,
    rolloutOffered,
    waiting,
    moving,
  });

  return (
    <Stack gap="xs">
      <Cluster gap="xs" justify="start" wrap>
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
 * Why this vehicle has no rollout button, in one sentence, or null when it has
 * one or when the question does not arise.
 *
 * <para>Two separate refusals collapse into one line here because an operator
 * only ever has one next move. RP-1's own reasons come first and OUTRANK the
 * pads entirely: no pad at this complex can take a vehicle its complex will not
 * release, so naming a busy pad as well would send an operator to clear
 * something that was never in the way.</para>
 *
 * <para>Silent for a vehicle still integrating and for one already moving. The
 * card's badge and its progress bar have both already said so, and a third
 * sentence repeating it is what turns a card into a paragraph.</para>
 */
function withheldRolloutReason({
  rolloutOffered,
  eligiblePads,
  pads,
  refusals,
  waiting,
  moving,
}: Readonly<{
  rolloutOffered: boolean;
  eligiblePads: readonly string[];
  pads: readonly Rp1PadEntry[];
  refusals: readonly string[] | undefined;
  waiting: boolean;
  moving: boolean;
}>): string | null {
  if (waiting || moving) {
    return null;
  }
  if (refusals !== undefined) {
    return refusals.join("; ");
  }
  if (rolloutOffered && eligiblePads.length === 0) {
    return noPadReason(pads);
  }
  return null;
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
 * <para><b>Eligibility comes off the wire, not from a rule reproduced here.</b>
 * A pad is offerable when RP-1 says its state is Free AND that no craft is
 * standing on it, and those are two separate facts because <c>state</c> cannot
 * see the second: a vehicle already sent to the launch site has no operation
 * left on the pad, so the pad still reads Free. The VEHICLE's own half arrives
 * as <c>rolloutRefusals</c> and is weighed separately, because it is the same
 * answer for every pad the complex owns.</para>
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
  waiting,
  operation,
}: Readonly<{
  item: Rp1BuildItemEntry | Rp1WarehouseItemEntry;
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
 * How far along the work on this vehicle is, and what the clock beside it is
 * counting DOWN TO.
 *
 * <para>A bare "45d" is the defect this replaces: it was the only number on the
 * card with no noun, so it could equally have been how long the vehicle has been
 * queued, how long it took to build, or how long the pad is booked for. Every
 * duration here names its own end.</para>
 *
 * <para>Three states rather than two, the same split LaunchComplexStatus draws:
 * an ETA, a rate RP-1 resolved at zero, and a project RP-1 has not costed yet.
 * The last is not a stall, and telling an operator their build has stopped when
 * RP-1 simply has not priced it yet would send them looking for a fault.</para>
 */
function VehicleProgress({
  item,
  label,
  operation,
}: Readonly<{
  item: Rp1BuildItemEntry | Rp1WarehouseItemEntry;
  label: string;
  operation: Rp1OperationEntry | undefined;
}>) {
  if (operation !== undefined) {
    if (atPad(operation)) {
      return null;
    }
    const ending =
      operation.type === "Rollback"
        ? "until it is back in the warehouse"
        : "until it reaches the pad";
    return (
      <WorkProgress
        ariaLabel={`${operation.type === "Rollback" ? "Rollback" : "Rollout"} progress, ${label}`}
        ending={ending}
        ratio={magnitudeOf(operation.progressRatio)}
        timeLeftSeconds={operation.timeLeftSeconds}
      />
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
  if (build.timeLeftSeconds === undefined || build.timeLeftSeconds === null) {
    return (
      <Text size="xs" tone="muted">
        {build.stalled === true
          ? "Integration is stalled and has no end date."
          : `${NULL_DISPLAY} RP-1 has not costed this build yet.`}
      </Text>
    );
  }
  return (
    <WorkProgress
      ariaLabel={`Integration progress, ${label}`}
      ending="until integration finishes"
      ratio={magnitudeOf(build.progressRatio)}
      timeLeftSeconds={build.timeLeftSeconds}
    />
  );
}

/**
 * A bar and the clock that goes with it. The clock always carries the phrase
 * saying what it ends at, and the bar is omitted rather than drawn at zero when
 * RP-1 reports no fraction: a full-width empty track says "no progress made",
 * which is a different claim from "we cannot see the progress".
 */
function WorkProgress({
  ratio,
  timeLeftSeconds,
  ending,
  ariaLabel,
}: Readonly<{
  ratio: number | null;
  timeLeftSeconds: Rp1BuildItemEntry["timeLeftSeconds"];
  ending: string;
  ariaLabel: string;
}>) {
  return (
    <Stack gap="xs">
      {ratio !== null && (
        <ProgressBar ariaLabel={ariaLabel} value={ratio * 100} />
      )}
      <Text size="xs" tone="muted">
        <Countdown value={timeLeftSeconds} /> {ending}
      </Text>
    </Stack>
  );
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
 * build" would be a lie about what the game does. That is also why the complexes
 * get a list of their own below the vehicles rather than a control tucked into
 * one vehicle's card.</para>
 *
 * <para>The row is named for the COMPLEX, because that is what it is: a row
 * called "LC-1 rush" reads as a second thing called LC-1 rush that also happens
 * to have a rush button. What the press does is the button's job to say.</para>
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
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
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
      <RowName>{complex.name ?? NULL_DISPLAY}</RowName>
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
    </Row>
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
 * Whether the vehicle is somewhere an operator can leave it: finished and
 * standing in the warehouse, or finished and standing on the pad. Everything
 * else is work in flight, which is the same split the badge draws and is read
 * off the same three inputs so the two cannot disagree.
 */
function settled(
  item: Rp1BuildItemEntry | Rp1WarehouseItemEntry,
  waiting: boolean,
  operation: Rp1OperationEntry | undefined,
): boolean {
  if (operation !== undefined) {
    return operation.type === "Rollout" && atPad(operation);
  }
  return !waiting && (item as Rp1BuildItemEntry).stalled !== true;
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
 * A `Card as="li"` and a `Row` are both list items, so they need list semantics
 * around them; see LaunchComplexStatus for the same reset and why it is inline.
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
