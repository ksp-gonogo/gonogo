import { CommandErrorCode } from "../__generated__/contract";
import { commandRail } from "../commands";
import { isValue } from "../unit-system/value";
import type { ViewClockView } from "./context";

/** Why a command was refused for arriving too late, in the words its refusal carries. */
export const LATE_ARRIVAL_DETAIL =
  "it would reach the craft at or after the time it acts at";

/** The code a late-arrival refusal carries: the argument is out of the range the command can still act on. */
export const LATE_ARRIVAL_ERROR_CODE = CommandErrorCode.Range;

/**
 * When a command sent now reaches the craft: the send time plus the one-way
 * light time, or the send time itself for a command that does not ride the
 * delay. `undefined` before the clock has anything to say.
 */
export function arrivalUtOf(
  clock: Pick<ViewClockView, "viewUt" | "scetUt" | "commandArrivalUt">,
  delayed: boolean,
): number | undefined {
  const sendUt = clock.scetUt(clock.viewUt());
  const arrival = delayed ? clock.commandArrivalUt(sendUt) : sendUt;
  return Number.isFinite(arrival) ? arrival : undefined;
}

/**
 * Whether `command` would reach the craft at or after the UT it acts at, read
 * off the args field its declaration names. A command that declares no such
 * field, args that do not carry it, or an unknown arrival judge nothing: the
 * mod stays the authority there.
 */
export function arrivesTooLate(
  command: string,
  args: unknown,
  arrivalUt: number | undefined,
): boolean {
  const field = commandRail(command)?.arriveBefore;
  if (field === undefined || arrivalUt === undefined) return false;
  if (typeof args !== "object" || args === null) return false;
  return actsAtOrBefore(Reflect.get(args, field), arrivalUt);
}

/** Whether a UT argument, written bare or as a `Value`, lies at or before `ut`. Anything else judges nothing. */
function actsAtOrBefore(arg: unknown, ut: number): boolean {
  if (typeof arg === "number") return Number.isFinite(arg) && arg <= ut;
  return isValue(arg) && arg.isFinite() && arg.lessThanOrEqual(ut);
}
