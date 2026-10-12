import { useCallback, useMemo } from "react";
import { isUnit } from "../unit-system/guards";
import { isValue, type Value } from "../unit-system/value";
import type { TelemetryClient } from "./client";
import { type HeldCommand, JOURNEY_TOPIC, readJourney } from "./comms-journey";
import { useTelemetryClientOptional } from "./context";
import { useLatestValue } from "./use-stream";

/**
 * The cancel command: stops a held or travelling command, or it and everything
 * behind it on its lane. Useful for letting the operator withdraw a command
 * sent to a vessel before it runs. Sent by `sendUplinkAction`.
 */
export const UPLINK_CANCEL_COMMAND = "system.uplink.cancel";

/**
 * The send-again command: a new copy of a held or overdue command, in its own
 * place on its lane. Useful for letting the operator retry a command that has
 * not reached the vessel. Sent by `sendUplinkAction`.
 */
export const UPLINK_RESEND_COMMAND = "system.uplink.resend";

/**
 * What a cancel or a send again did at the sending command centre: the cancel's
 * last lane number, the new copy's id and expiry, or why it was refused. Useful
 * for telling the operator whether the cancel or resend of a command took
 * effect. Returned by `sendUplinkAction` and used by the command group that
 * follows a batch of sends.
 *
 * @category Commands
 */
export interface UplinkActionOutcome {
  /** For a cancel, the last lane number it covers: more than counted when another screen sent on the lane meanwhile. */
  throughSeq?: Value<"count">;
  /** For a send again, the new copy's id, which its journey reports name. */
  id?: string;
  /** When the cancel or the copy expires. */
  expiresAtUt?: Value<"ut">;
  /** Why it was refused, when it was. */
  refusal?: string;
}

/**
 * The reply to a cancel or a send again as an `UplinkActionOutcome`. Useful for
 * telling the operator whether the command was withdrawn or sent again. Used by
 * `sendUplinkAction`.
 */
export function readUplinkActionReply(result: unknown): UplinkActionOutcome {
  if (typeof result !== "object" || result === null) {
    return { refusal: "no answer" };
  }
  if ("success" in result && result.success === false) {
    return {
      refusal:
        "reason" in result && typeof result.reason === "string"
          ? result.reason
          : "refused",
    };
  }
  const payload = "payload" in result ? result.payload : undefined;
  if (typeof payload !== "object" || payload === null) {
    return {};
  }
  const throughSeq = "throughSeq" in payload ? payload.throughSeq : undefined;
  const id =
    "id" in payload && typeof payload.id === "string" && payload.id !== ""
      ? payload.id
      : undefined;
  const expiresAtUt =
    "expiresAtUt" in payload ? payload.expiresAtUt : undefined;
  return {
    ...(isValue(throughSeq) && isUnit(throughSeq, "count")
      ? { throughSeq }
      : {}),
    ...(id === undefined ? {} : { id }),
    ...(isValue(expiresAtUt) && isUnit(expiresAtUt, "ut")
      ? { expiresAtUt }
      : {}),
  };
}

/**
 * Sends a cancel or a send again for the timeline `epoch` through `client`, and
 * returns the reply as an `UplinkActionOutcome`. Useful for withdrawing or
 * retrying a command the operator sent to a vessel. Used by the command group
 * that follows a batch of sends.
 */
export async function sendUplinkAction(
  client: TelemetryClient,
  epoch: Value<"count">,
  command: string,
  args: Record<string, unknown>,
): Promise<UplinkActionOutcome> {
  const { result } = client.dispatch(command, { epoch, ...args });
  try {
    return readUplinkActionReply(await result);
  } catch (error) {
    return { refusal: error instanceof Error ? error.message : "refused" };
  }
}

/**
 * The two actions a held command offers, cancel and send again, bound to this
 * session's client and the current timeline. Useful for giving the operator
 * controls over a command that is waiting for the vessel. Returned by
 * `useHeldCommandActions`.
 */
export interface HeldCommandActions {
  /** Cancels the command, or it and every later command on its lane. */
  cancel(
    command: HeldCommand,
    andBehind: boolean,
  ): Promise<UplinkActionOutcome>;
  /** Sends the command again in its own place on its lane. */
  sendAgain(command: HeldCommand): Promise<UplinkActionOutcome>;
}

/**
 * Cancel and send-again for held commands, from this session's command centre.
 * Useful for giving the operator controls over a command that is waiting for the
 * vessel.
 *
 * Both name the timeline the latest journey carries, so a request made across a
 * game load is refused and never applied to a different game.
 */
export function useHeldCommandActions(): HeldCommandActions {
  // gonogo:reads none
  const client = useTelemetryClientOptional();
  const journeyPayload = useLatestValue<unknown>(JOURNEY_TOPIC);
  const epoch = useMemo(
    () => readJourney(journeyPayload)?.epoch,
    [journeyPayload],
  );

  const send = useCallback(
    async (
      command: string,
      args: Record<string, unknown>,
    ): Promise<UplinkActionOutcome> => {
      if (!client || epoch === undefined) {
        return { refusal: "not connected" };
      }
      return sendUplinkAction(client, epoch, command, args);
    },
    [client, epoch],
  );

  return useMemo(
    () => ({
      cancel: (held, andBehind) =>
        send(UPLINK_CANCEL_COMMAND, {
          craft: held.craft,
          laneSeq: held.laneSeq,
          andBehind,
        }),
      sendAgain: (held) =>
        send(UPLINK_RESEND_COMMAND, {
          craft: held.craft,
          laneSeq: held.laneSeq,
        }),
    }),
    [send],
  );
}
