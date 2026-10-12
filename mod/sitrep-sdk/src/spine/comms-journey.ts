import { JourneyEventKind } from "../__generated__/contract";
import { isUnit } from "../unit-system/guards";
import { isValue, type Value, value } from "../unit-system/value";

/**
 * The `comms.journey` channel topic: journey reports for the commands held for
 * this command centre, each arriving when the centre could first know it.
 * Useful for showing the operator where a command sent to a vessel is. Read by
 * the command group that follows a batch of sends.
 */
export const JOURNEY_TOPIC = "comms.journey";

/**
 * The `system.uplink.pending` topic: the queue of commands sent from the
 * command centre that have not yet run on the vessel. Useful for showing the
 * operator which commands are held and what is predicted for them. Read by the
 * command group that follows a batch of sends.
 */
export const PENDING_TOPIC = "system.uplink.pending";

/**
 * One report on a command's journey from the command centre to the vessel:
 * what happened to it, at which node, and at what UT. Useful for showing the
 * operator where a command has got to. Returned inside a `Journey` by
 * `readJourney` and filtered by `journeyOf`.
 */
export interface JourneyEvent {
  id: string;
  /** The pending entry id of the command it is about, or a cancel's id. */
  about: string;
  craft: string;
  laneSeq: Value<"count">;
  kind: JourneyEventKind;
  /** The node that made the report. */
  at: string;
  /** When it happened at that node. */
  atUt: Value<"ut">;
  /** A hold's predicted departure, a departure's landing, or when a late cancel's command ran or left. */
  untilUt?: Value<"ut">;
  detail?: string;
  /** For a waiting report, the lane numbers still missing at the craft. */
  missing: readonly Value<"count">[];
}

/**
 * The journey reports of a `comms.journey` payload, with the timeline they
 * belong to. Useful for showing the operator the state of every command sent
 * to a vessel. Returned by `readJourney`.
 */
export interface Journey {
  /** The timeline its events belong to: what a cancel or a send again must name. */
  epoch: Value<"count">;
  events: readonly JourneyEvent[];
}

function readUt(field: unknown): Value<"ut"> | undefined {
  if (typeof field === "number") {
    return Number.isFinite(field) ? value("ut", field) : undefined;
  }
  return isValue(field) && isUnit(field, "ut") && field.isFinite()
    ? field
    : undefined;
}

/** A wire count, bare or wrapped by the decode, as a count, or undefined. */
function readCount(field: unknown): Value<"count"> | undefined {
  if (typeof field === "number") {
    return Number.isFinite(field) ? value("count", field) : undefined;
  }
  return isValue(field) && isUnit(field, "count") && field.isFinite()
    ? field
    : undefined;
}

function readEvent(raw: unknown): JourneyEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const id = "id" in raw ? raw.id : undefined;
  const about = "about" in raw ? raw.about : undefined;
  const craft = "craft" in raw ? raw.craft : undefined;
  const at = "at" in raw ? raw.at : undefined;
  const laneSeq = readCount("laneSeq" in raw ? raw.laneSeq : undefined);
  const kindOrdinal = "kind" in raw ? raw.kind : undefined;
  const atUt = readUt("atUt" in raw ? raw.atUt : undefined);
  if (
    typeof id !== "string" ||
    typeof about !== "string" ||
    typeof craft !== "string" ||
    typeof at !== "string" ||
    laneSeq === undefined ||
    typeof kindOrdinal !== "number" ||
    JourneyEventKind[kindOrdinal] === undefined ||
    atUt === undefined
  ) {
    return null;
  }
  const untilUt = readUt("untilUt" in raw ? raw.untilUt : undefined);
  const detail =
    "detail" in raw && typeof raw.detail === "string" ? raw.detail : undefined;
  const missing =
    "missing" in raw && Array.isArray(raw.missing)
      ? raw.missing.flatMap((n) => {
          const read = readCount(n);
          return read === undefined ? [] : [read];
        })
      : [];
  return {
    id,
    about,
    craft,
    laneSeq,
    kind: kindOrdinal as JourneyEventKind,
    at,
    atUt,
    ...(untilUt === undefined ? {} : { untilUt }),
    ...(detail === undefined ? {} : { detail }),
    missing,
  };
}

/**
 * A `comms.journey` payload as a `Journey`, or `null` for a payload that is not
 * one. A malformed event is left out. Useful for reading the journey reports
 * of the commands sent to a vessel. Used by the command group that follows a
 * batch of sends and by the held-command actions that cancel or resend.
 */
export function readJourney(payload: unknown): Journey | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (!("events" in payload) || !Array.isArray(payload.events)) return null;
  const epoch =
    readCount("epoch" in payload ? payload.epoch : undefined) ??
    value("count", 0);
  return {
    epoch,
    events: payload.events.flatMap((raw) => readEvent(raw) ?? []),
  };
}

/**
 * Every event about one command, found by its vessel and lane number, ordered
 * by when each happened at its node. Reports from different nodes travel
 * different routes, so arrival order is not the order of events. Useful for
 * showing the operator the history of one command.
 */
export function journeyOf(
  journey: Journey,
  craft: string,
  laneSeq: Value<"count">,
): readonly JourneyEvent[] {
  return journey.events
    .filter((e) => e.craft === craft && e.laneSeq.equals(laneSeq))
    .sort((a, b) =>
      a.atUt.lessThan(b.atUt) ? -1 : b.atUt.lessThan(a.atUt) ? 1 : 0,
    );
}

/**
 * How a command's journey ended, once a report from a node that settles it has
 * arrived. Useful for showing the operator whether a command ran, expired or
 * was cancelled. Returned by `outcomeOf`.
 */
export type JourneyOutcome =
  | "ran"
  | "expired"
  | "cancelled"
  | "discarded"
  | "cancelLate";

/**
 * The outcome a command's events settle on, or undefined while nothing has
 * settled it. Useful for showing the operator whether a command ran, expired
 * or was cancelled.
 *
 * A cancel counts only once a node that stopped or will stop the command
 * reports it, and sending a cancel is not enough. Once settled, an earlier
 * event arriving late does not change the outcome.
 */
export function outcomeOf(
  events: readonly JourneyEvent[],
): JourneyOutcome | undefined {
  for (const e of events) {
    switch (e.kind) {
      case JourneyEventKind.Ran:
        return "ran";
      case JourneyEventKind.Expired:
        return "expired";
      case JourneyEventKind.Cancelled:
      case JourneyEventKind.CancelStored:
        return "cancelled";
      case JourneyEventKind.CancelLate:
        return "cancelLate";
      case JourneyEventKind.Discarded:
        if (e.detail === "cancelled") return "cancelled";
        if (e.detail !== "a copy is already waiting") return "discarded";
        break;
      default:
        break;
    }
  }
  return undefined;
}

function waitingAfter(
  e: JourneyEvent,
  before: { node: string; untilUt?: Value<"ut"> } | undefined,
): { node: string; untilUt?: Value<"ut"> } | undefined {
  switch (e.kind) {
    case JourneyEventKind.Held:
      return {
        node: e.at,
        ...(e.untilUt === undefined ? {} : { untilUt: e.untilUt }),
      };
    case JourneyEventKind.Departed:
      return undefined;
    case JourneyEventKind.Waiting:
      return { node: e.at };
    default:
      return before;
  }
}

/**
 * Where a command is known to be waiting: the node of its latest hold that no
 * later departure has followed, or the vessel once the command is waiting
 * there behind a missing lane number. Undefined when no report says it is
 * waiting anywhere. Useful for showing the operator where a cancel has to
 * reach a held command.
 */
export function heldAt(
  events: readonly JourneyEvent[],
): { node: string; untilUt?: Value<"ut"> } | undefined {
  let at: { node: string; untilUt?: Value<"ut"> } | undefined;
  for (const e of events) {
    at = waitingAfter(e, at);
  }
  return at;
}

/**
 * The store-and-forward facts of one pending command: its lane number, expiry,
 * predicted hold and cancel deadline, all of them the sending command centre's
 * own predictions. Useful for showing the operator where a command is expected
 * to wait. Returned by `heldCommandOf` and taken by the held-command actions
 * that cancel or resend a command.
 */
export interface HeldCommand {
  laneSeq: Value<"count">;
  craft: string;
  expiresAtUt?: Value<"ut">;
  predictedHeldAt?: string;
  predictedHeldUntilUt?: Value<"ut">;
  cancelDeadlineUt?: Value<"ut">;
  attempts: Value<"count">;
  members: readonly string[];
}

/**
 * The held-command facts of a `system.uplink.pending` entry, or undefined for
 * an entry on no lane. Useful for showing the operator which commands are held
 * for a vessel and for how long.
 */
export function heldCommandOf(entry: unknown): HeldCommand | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const laneSeq = readCount("laneSeq" in entry ? entry.laneSeq : undefined);
  const craft = "craft" in entry ? entry.craft : undefined;
  if (laneSeq === undefined || typeof craft !== "string") return undefined;
  const expiresAtUt = readUt(
    "expiresAtUt" in entry ? entry.expiresAtUt : undefined,
  );
  const predictedHeldUntilUt = readUt(
    "predictedHeldUntilUt" in entry ? entry.predictedHeldUntilUt : undefined,
  );
  const cancelDeadlineUt = readUt(
    "cancelDeadlineUt" in entry ? entry.cancelDeadlineUt : undefined,
  );
  const predictedHeldAt =
    "predictedHeldAt" in entry && typeof entry.predictedHeldAt === "string"
      ? entry.predictedHeldAt
      : undefined;
  const attempts =
    readCount("attempts" in entry ? entry.attempts : undefined) ??
    value("count", 1);
  const members =
    "members" in entry && Array.isArray(entry.members)
      ? entry.members.filter((m): m is string => typeof m === "string")
      : [];
  return {
    laneSeq,
    craft,
    ...(expiresAtUt === undefined ? {} : { expiresAtUt }),
    ...(predictedHeldAt === undefined ? {} : { predictedHeldAt }),
    ...(predictedHeldUntilUt === undefined ? {} : { predictedHeldUntilUt }),
    ...(cancelDeadlineUt === undefined ? {} : { cancelDeadlineUt }),
    attempts,
    members,
  };
}

/**
 * The vessel and lane number of the pending command a request belongs to,
 * matched on the `clientRequestId` the sending client gave it, or on the
 * members a group entry lists. Null when no entry names it or the entry is on
 * no lane. Useful for following a command the operator just sent along its
 * journey. Used by the command group that follows a batch of sends.
 */
export function readPendingLane(
  payload: unknown,
  clientRequestId: string,
): { craft: string; laneSeq: Value<"count"> } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const pending = "pending" in payload ? payload.pending : undefined;
  if (!Array.isArray(pending)) return null;
  for (const entry of pending) {
    if (typeof entry !== "object" || entry === null) continue;
    const mine =
      ("clientRequestId" in entry &&
        entry.clientRequestId === clientRequestId) ||
      ("members" in entry &&
        Array.isArray(entry.members) &&
        entry.members.includes(clientRequestId));
    const craft = "craft" in entry ? entry.craft : undefined;
    const laneSeq = readCount("laneSeq" in entry ? entry.laneSeq : undefined);
    if (mine && typeof craft === "string" && laneSeq !== undefined) {
      return { craft, laneSeq };
    }
  }
  return null;
}
