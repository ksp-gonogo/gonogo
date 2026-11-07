import { useLatestValue, useUtNow } from "./api";
import type { PendingEntry } from "./command-delay";
import { type Value, value } from "./unit-system/value";

/**
 * One command that sets a value, still on its way to the craft or with its
 * reply still to come home: the value it sets, when it was sent, and when it
 * reaches the craft. Useful for working out where a craft's setting is now
 * while commands for it travel. Listed in {@link ValueCommandState} and read by
 * {@link expectedAtCraft}.
 *
 * @category Delay and vantage
 */
export interface ValueCommandInFlight {
  /** The value the command sets. */
  value: number;
  /** When it was sent. */
  sentAt: Value<"ut">;
  /** When it reaches the craft; `null` when the sending centre knew no route. */
  arrivesAt: Value<"ut"> | null;
}

/**
 * The command centre's queue of commands in flight, as far as
 * {@link valueCommandState} reads it: the value of the
 * `system.uplink.pending` Topic. Useful for a host that reads that Topic
 * itself and passes it in.
 *
 * @category Delay and vantage
 */
export interface ValueCommandQueueLike {
  /** Every command the centre has sent that has not yet been answered, from every screen at the centre. */
  pending: readonly PendingEntry[];
}

/** The commands for `command` still on the queue that carry the value they set, oldest sent first, narrowed by `matches`. */
function valueCommandsInFlight(
  queue: ValueCommandQueueLike | undefined,
  command: string,
  matches?: (entry: PendingEntry) => boolean,
): ValueCommandInFlight[] {
  const out: ValueCommandInFlight[] = [];
  for (const entry of queue?.pending ?? []) {
    if (entry.command !== command) continue;
    if (typeof entry.commandedValue !== "number") continue;
    if (matches && !matches(entry)) continue;
    const oneWay = entry.oneWaySeconds ?? null;
    out.push({
      value: entry.commandedValue,
      sentAt: entry.dispatchedAt,
      arrivesAt:
        entry.predictedArrivalUt ??
        (oneWay !== null ? entry.dispatchedAt.plus(oneWay) : null),
    });
  }
  return out.sort((a, b) => a.sentAt.compare(b.sentAt));
}

/**
 * The value the craft is expected to hold now, at its own time: the value set
 * by the last of the commands in flight to have reached it by `now`, taken
 * in the order they arrive, else `received`, the value the craft last
 * reported. `null` when there is neither. Useful for showing the operator
 * where the craft's setting is while a command's reading is still on its way
 * home. Used by {@link useValueCommand}.
 *
 * @category Delay and vantage
 */
export function expectedAtCraft(
  inFlight: readonly ValueCommandInFlight[],
  received: number | null,
  now: Value<"ut">,
): number | null {
  let last: { value: number; arrivesAt: Value<"ut"> } | null = null;
  for (const c of inFlight) {
    if (c.arrivesAt === null || c.arrivesAt.greaterThan(now)) continue;
    if (last === null || c.arrivesAt.greaterThanOrEqual(last.arrivesAt)) {
      last = { value: c.value, arrivesAt: c.arrivesAt };
    }
  }
  return last?.value ?? received;
}

/** How long past the round trip this screen's own value stays the commanded one while the queue has not yet listed it. */
const OWN_VALUE_SLACK = value("s", 2);

/**
 * What a control that sets a value shows, the same on every screen at the
 * command centre: the value commanded, the value the craft is expected to hold
 * now, and the commands still on their way. Useful for drawing a slider or
 * stepper whose commands travel under delay. Returned by
 * {@link useValueCommand} and {@link valueCommandState}.
 *
 * @category Delay and vantage
 */
export interface ValueCommandState {
  /** The newest value sent by any screen, or this screen's own while it is newer and unanswered, else the value received; `null` when there is none of them. */
  commanded: number | null;
  /** The value the craft is expected to hold now, from {@link expectedAtCraft}. */
  expected: number | null;
  /** The commands still in flight, oldest sent first. */
  inFlight: ValueCommandInFlight[];
}

/**
 * What a control that sets a value knows of its own: the value the craft last
 * reported, this screen's newest value, and which queued commands are for it.
 * Useful for a control that addresses one of several parts. Taken by
 * {@link useValueCommand} and {@link valueCommandState}.
 *
 * @category Delay and vantage
 */
export interface ValueCommandOptions {
  /** The value the craft last reported, or `null` when it has not. */
  received: number | null;
  /** This screen's newest value and when it set it, so the control follows the press before the queue lists it. */
  own?: { value: number; at: Value<"ut"> } | null;
  /** Narrows the queued commands to the ones for this control's part. */
  matches?: (entry: PendingEntry) => boolean;
}

/**
 * The pure half of {@link useValueCommand}: what a control that sets a value
 * shows, from the centre's queue, the one-way delay (`null` when no route is
 * known, counted as none) and the time now. Useful
 * for a host that reads those itself. Used by {@link useValueCommand}.
 *
 * @category Delay and vantage
 */
export function valueCommandState(
  command: string,
  opts: ValueCommandOptions,
  queue: ValueCommandQueueLike | undefined,
  oneWay: Value<"s"> | null,
  now: Value<"ut">,
): ValueCommandState {
  const inFlight = valueCommandsInFlight(queue, command, opts.matches);
  const newest = inFlight.at(-1) ?? null;
  const own = opts.own ?? null;
  const roundTrip = (oneWay ?? value("s", 0)).times(2);
  const ownCurrent =
    own !== null &&
    (newest === null || own.at.greaterThanOrEqual(newest.sentAt)) &&
    now.minus(own.at).lessThanOrEqual(roundTrip.plus(OWN_VALUE_SLACK));
  const commanded = ownCurrent ? own.value : (newest?.value ?? opts.received);
  return {
    commanded,
    expected: expectedAtCraft(inFlight, opts.received, now),
    inFlight,
  };
}

/**
 * What a control that sets a value shows, the same on every screen at the
 * command centre: the value commanded, and the value the craft is expected to
 * hold now. Useful for a slider or stepper that keeps reading true while its
 * commands travel. Used with `CommandSlider` and `CommandStepper` from
 * `@ksp-gonogo/ui-kit`, by the Rotor Tachometer and Robotics Console.
 *
 * @category Delay and vantage
 */
export function useValueCommand(
  command: string,
  opts: ValueCommandOptions,
): ValueCommandState {
  // gonogo:reads system.uplink.pending
  const queue = useLatestValue<ValueCommandQueueLike>("system.uplink.pending");
  // gonogo:reads comms.delay
  const delay = useLatestValue<{ oneWaySeconds?: Value<"s"> | null }>(
    "comms.delay",
  );
  // gonogo:reads none
  const nowUt = useUtNow() ?? 0;
  return valueCommandState(
    command,
    opts,
    queue,
    delay?.oneWaySeconds ?? null,
    value("ut", nowUt),
  );
}
