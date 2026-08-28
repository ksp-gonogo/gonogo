import { magnitudeOf } from "@ksp-gonogo/ui-kit";
import type {
  Rp1BuildItemEntry,
  Rp1ComplexEntry,
  Rp1OperationEntry,
  Rp1PadEntry,
  Rp1WarehouseItemEntry,
} from "../__generated__/contract";

/** A vehicle from either of RP-1's two lists: the warehouse or the build queue. */
export type Vehicle = Rp1BuildItemEntry | Rp1WarehouseItemEntry;

/**
 * The rollout or rollback moving this vehicle, or undefined.
 *
 * <para>Joined on <c>shipId</c>, which is a DIFFERENT id from the <c>id</c> a
 * command addresses: RP-1 stamps an operation's <c>associatedID</c> from
 * <c>shipID</c>, and the two ids live on the same vehicle for exactly this
 * reason. A vehicle with no <c>shipId</c> comes back as not moving, which is
 * the safe direction: the mod refuses a second rollout itself, so the worst
 * case is a control that can only be refused rather than one that acts
 * twice.</para>
 *
 * <para>Reconditioning and recovery are deliberately not matched. A
 * reconditioning belongs to a PAD and carries the pad's id, and a recovery is a
 * flight-scene operation with no control on this widget.</para>
 */
export function operationFor(
  operations: readonly Rp1OperationEntry[] | undefined,
  item: Vehicle,
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
export function atPad(operation: Rp1OperationEntry): boolean {
  return (magnitudeOf(operation.progressRatio) ?? 0) >= 1;
}

/**
 * Whether the vehicle is somewhere an operator can leave it: finished and
 * standing in the warehouse, or finished and standing on the pad. Everything
 * else is work in flight, which is the same split the badge draws and is read
 * off the same three inputs so the two cannot disagree.
 */
export function settled(
  item: Vehicle,
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
export function padsAt(
  pads: readonly Rp1PadEntry[] | undefined,
  lcId: string | undefined | null,
): readonly Rp1PadEntry[] {
  if (lcId === undefined || lcId === null) {
    return [];
  }
  return (pads ?? []).filter((pad) => pad.lcId === lcId);
}

/**
 * The names of the pads a rollout could actually go to: RP-1 calls them Free
 * and nothing is standing on them.
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
export function eligiblePadNames(
  pads: readonly Rp1PadEntry[],
): readonly string[] {
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
export function noPadReason(pads: readonly Rp1PadEntry[]): string {
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
export function withheldRolloutReason({
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
 * RP-1's reasons this vehicle cannot leave its complex, or undefined when it
 * has none.
 *
 * <para>Only the warehouse carries them: a vehicle still integrating cannot
 * roll out for a reason that has nothing to do with its envelope, so the mod
 * deliberately publishes none for it, and reading the field off the union
 * rather than casting a build row is what distinguishes "no objection" from
 * "not that kind of row".</para>
 */
export function rolloutRefusalsOf(
  item: Vehicle,
): readonly string[] | undefined {
  const refusals = (item as Rp1WarehouseItemEntry).rolloutRefusals;
  return refusals === undefined || refusals === null || refusals.length === 0
    ? undefined
    : refusals;
}

/** The complex a vehicle belongs to, or undefined when RP-1 named none. */
export function complexOf(
  complexes: readonly Rp1ComplexEntry[] | undefined,
  lcId: string | undefined | null,
): Rp1ComplexEntry | undefined {
  if (lcId === undefined || lcId === null) {
    return undefined;
  }
  return (complexes ?? []).find((c) => c.lcId === lcId);
}

/**
 * A stable key. RP-1's own id where there is one, because two vehicles of the
 * same design at the same complex are the point of this widget and would
 * otherwise share a key.
 */
export function rowKey(item: Vehicle): string {
  return item.id ?? `${item.lcId ?? ""}:${item.shipName ?? ""}`;
}

/**
 * Whether nobody is assigned to this complex.
 *
 * <para>RP-1 feeds `Engineers / MaxEngineers` into the portion of the build
 * rate a complex actually delivers, so a complex with nobody on it makes no
 * progress however many engineers the centre has hired. That is a different
 * fault from a stall an operator cannot fix by moving staff, and it is the
 * reason the two get different sentences.</para>
 *
 * <para>An unreadable count is not zero: RP-1 not answering is not RP-1 saying
 * nobody is assigned, and printing the fixable sentence for it would send an
 * operator to a staffing screen that already reads full.</para>
 */
export function unstaffed(complex: Rp1ComplexEntry | undefined): boolean {
  return magnitudeOf(complex?.engineers) === 0;
}

/**
 * The vehicles, ordered so that everything at one launch complex sits together.
 *
 * <para>What makes a flat list read as GROUPED by complex without nesting it
 * under headings. RP-1's own order for the complexes is kept, so a career's
 * oldest complex leads, and within a complex the wire order is kept: RP-1 lists
 * a build queue in the order it will work through it, and re-sorting that would
 * throw away the one ordering the game has an opinion about.</para>
 *
 * <para>A vehicle at a complex the wire never described goes last rather than
 * first. It cannot be gathered with anything, and leading with the one card
 * that has no place would make the whole list look unordered.</para>
 */
export function byComplex(
  items: readonly Vehicle[],
  complexes: readonly Rp1ComplexEntry[] | undefined,
): readonly Vehicle[] {
  const order = new Map<string, number>();
  for (const [index, complex] of (complexes ?? []).entries()) {
    if (complex.lcId !== undefined && complex.lcId !== null) {
      order.set(complex.lcId, index);
    }
  }
  const place = (item: Vehicle) =>
    order.get(item.lcId ?? "") ?? Number.MAX_SAFE_INTEGER;
  // A COPY, because the array is the decoded payload the stream still holds and
  // sorting it in place would reorder it for every other reader of that frame.
  return [...items]
    .map((item, index) => ({ index, item }))
    .sort((a, b) => place(a.item) - place(b.item) || a.index - b.index)
    .map((entry) => entry.item);
}
