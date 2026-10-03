import { useCallback, useMemo } from "react";
import { isUnit } from "../unit-system/guards";
import { isValue, type Value } from "../unit-system/value";
import { type HeldCommand, JOURNEY_TOPIC, readJourney } from "./comms-journey";
import { useTelemetryClientOptional } from "./context";
import { useLatestValue } from "./use-stream";

/** The cancel command: stops a held or travelling command, or it and everything behind it on its lane. */
export const UPLINK_CANCEL_COMMAND = "system.uplink.cancel";

/** The send-again command: a new copy of a held or overdue command, in its own place on its lane. */
export const UPLINK_RESEND_COMMAND = "system.uplink.resend";

/** What a cancel or a send again did at the sending centre. */
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

/** A cancel or send-again reply as an outcome. */
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

/** The two actions a held command offers, bound to this session's client and the current timeline. */
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
 * Cancel and send-again for held commands, from this session's vantage. Both
 * name the timeline the latest journey carries, so a request made across a
 * game load is refused rather than applied to a different game.
 */
export function useHeldCommandActions(): HeldCommandActions {
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
      const { result } = client.dispatch(command, { epoch, ...args });
      try {
        return readUplinkActionReply(await result);
      } catch (error) {
        return { refusal: error instanceof Error ? error.message : "refused" };
      }
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
