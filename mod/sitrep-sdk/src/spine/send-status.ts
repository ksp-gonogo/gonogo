import { isUnit } from "../unit-system/guards";
import { isValue, type Value, value } from "../unit-system/value";
import type { RouteRow } from "./comms-route";

/**
 * Whether the addressee can be reached now, and when that changes: in contact,
 * about to lose contact, out of contact until the plan has it back, or out of
 * contact with no return predicted.
 *
 * @category Commands
 */
export type ContactStatus =
  | {
      /** Which of the four states this is. */
      kind: "in-contact";
    }
  | {
      /** Which of the four states this is. */
      kind: "loss-in";
      /** How long until the plan predicts contact is lost. */
      seconds: Value<"s">;
    }
  | {
      /** Which of the four states this is. */
      kind: "back-in";
      /** How long until the plan predicts contact returns. */
      seconds: Value<"s">;
    }
  | {
      /** Which of the four states this is. */
      kind: "none";
    };

/**
 * What a send is expected to do, assuming nobody intervenes.
 *
 * @category Commands
 */
export type Arrival = "expected" | "likely-lost";

/**
 * What a command control can say about an order sent now: whether it goes at
 * once or is held for a predicted contact, how long its signal takes, and
 * whether it is expected to arrive. A command routed from a command centre to
 * the active craft carries `sends`; a message to a group carries none.
 * Written out by `describeSendStatus` for a control's tooltip. Returned by {@link useCommand} as `sendStatus`.
 *
 * @category Commands
 */
export interface SendStatus {
  /** Whether the addressee can be reached now, and when that changes. */
  contact: ContactStatus;
  /** Signal time along the route, waits included; absent when there is no route. */
  signalDelay?: Value<"s">;
  /** Whether the message is expected to arrive, assuming nobody intervenes. */
  arrival: Arrival;
  /** `"now"` when nothing waits anywhere on the route, `"held"` when it waits for a predicted contact. */
  sends?: "now" | "held";
  /** When a held command is predicted to leave its first waiting node. */
  heldUntilUt?: Value<"ut">;
  /** When the command is predicted to reach the craft, waits included. */
  arrivesUt?: Value<"ut">;
}

/** The universal time of a `comms.nextLoss` payload's prediction, or `undefined` unless the plan predicts a loss. */
export function readNextLossUt(payload: unknown): Value<"ut"> | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  if (!("basis" in payload) || payload.basis !== "predicted-loss") {
    return undefined;
  }
  const ut = "ut" in payload ? payload.ut : undefined;
  if (typeof ut === "number") {
    return Number.isFinite(ut) ? value("ut", ut) : undefined;
  }
  return isValue(ut) && isUnit(ut, "ut") && ut.isFinite() ? ut : undefined;
}

/**
 * The status of an order sent now from a command centre to the active craft,
 * from the centre's `comms.route` rows. The row used is the one leaving
 * `vantage` for a craft (any centre's row when `vantage` is omitted, since a
 * session is sent only its own centre's rows). Undefined when no such row
 * exists or the row's arrival has already passed, since nothing is known.
 * A row with no arrival is a send with no route.
 *
 * `nextLossUt` is the plan's predicted loss of the whole route to the craft
 * (see {@link readNextLossUt}). An order that goes at once and would arrive
 * after it is predicted to be lost on the way; an absent prediction makes no
 * claim.
 */
export function sendStatusFromRoutes(
  rows: readonly RouteRow[] | null | undefined,
  nowUt: number,
  vantage?: string,
  nextLossUt?: Value<"ut">,
): SendStatus | undefined {
  const row = rows?.find(
    (r) =>
      r.to.startsWith("vessel:") &&
      (vantage === undefined || r.from === vantage),
  );
  if (row === undefined) return undefined;
  if (row.arrivalUt === undefined) {
    return { contact: { kind: "none" }, arrival: "likely-lost" };
  }
  const now = value("ut", nowUt);
  if (!row.arrivalUt.greaterThan(now)) return undefined;
  const signalDelay = row.arrivalUt.minus(row.sentUt);
  if (!signalDelay.isFinite() || signalDelay.lessThan(0)) return undefined;
  const hold = row.live
    ? undefined
    : row.holds.find((h) => h.departUt.greaterThan(now));
  if (hold === undefined) {
    if (
      nextLossUt !== undefined &&
      nextLossUt.greaterThan(now) &&
      nextLossUt.lessThan(row.arrivalUt)
    ) {
      return {
        contact: { kind: "loss-in", seconds: nextLossUt.minus(now) },
        signalDelay,
        arrival: "likely-lost",
        sends: "now",
        arrivesUt: row.arrivalUt,
      };
    }
    return {
      contact: { kind: "in-contact" },
      signalDelay,
      arrival: "expected",
      sends: "now",
      arrivesUt: row.arrivalUt,
    };
  }
  return {
    contact: { kind: "back-in", seconds: hold.departUt.minus(now) },
    signalDelay,
    arrival: "expected",
    sends: "held",
    heldUntilUt: hold.departUt,
    arrivesUt: row.arrivalUt,
  };
}
