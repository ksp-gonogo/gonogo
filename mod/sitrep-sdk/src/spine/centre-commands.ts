import type { CommandErrorCode } from "../__generated__/error-codes";
import type { CommandStatus } from "../api/types";
import {
  classifyRetained,
  type InFlightCommand,
  type PathConnectedDuring,
  type PendingEntry,
  type SettledEntry,
} from "../command-delay";
import { type Value, value } from "../unit-system/value";
import type { CommandFailure, CommandFound, CommandRefusal } from "./lifecycle";
import type { PendingUplinkQueueLike } from "./resolve-tracked";

/**
 * The rail id of a command another sender put on the centre's queue. The
 * sender's own request id where there is one, so the same command found by two
 * handles of one panel, or as one handle's own dispatch, is one row.
 */
export function centreRowId(entry: PendingEntry): string {
  return entry.clientRequestId || `uplink:${entry.id}`;
}

function sentBy(entry: PendingEntry, own: ReadonlySet<string>): boolean {
  if (own.has(entry.clientRequestId)) return true;
  return entry.members?.some((member) => own.has(member)) ?? false;
}

function rowLabel(entry: PendingEntry): string {
  const size = entry.members?.length ?? 0;
  const name = entry.label || entry.command;
  return size > 1 ? `${name} (group of ${size})` : entry.label;
}

/** What the centre-command rows remember between renders, held by the hook. */
export interface CentreCommandMemory {
  /** Each row's last entry, kept so a loss outlives the entry leaving the queue. */
  entries: Map<string, PendingEntry>;
  /** Rows the operator dismissed, kept until the entry has left the queue. */
  dismissed: Set<string>;
  /** Each outcome the centre reported, by row id, kept until dismissed. */
  outcomes: Map<
    string,
    { entry: SettledEntry; dismissed: boolean; found: boolean }
  >;
  /** Rows this hook last drew overdue or lost, whose outcome, when it comes, is a found. */
  unanswered: Set<string>;
  /** When this hook first looked at the queue; an outcome reported before it is old news. */
  since: Value<"ut"> | null;
  /** The timeline epoch `since` was taken in; a quickload starts a new one and `since` with it. */
  sinceEpoch: number | null;
}

export function createCentreCommandMemory(): CentreCommandMemory {
  return {
    entries: new Map(),
    dismissed: new Set(),
    outcomes: new Map(),
    unanswered: new Set(),
    since: null,
    sinceEpoch: null,
  };
}

const NO_REFUSALS: CommandRefusal[] = [];
const NO_FAILURES: CommandFailure[] = [];
const NO_FOUNDS: CommandFound[] = [];

/** The id a settled entry's row and outcome go by, as {@link centreRowId} gives a queue entry's. */
function settledId(entry: SettledEntry): string {
  return entry.clientRequestId || `uplink:${entry.id}`;
}

/**
 * The refusals, failures and founds the centre reported for every queued
 * `command` this hook did not send, shaped as the hook's own. An outcome for a
 * command this hook was drawing overdue or lost is a found, as the sender's
 * own late answer is. Each lasts until dismissed with
 * {@link dismissCentreOutcome}, after the centre has stopped listing it.
 */
export function centreCommandOutcomes(args: {
  command: string;
  queue: PendingUplinkQueueLike | undefined;
  own: ReadonlySet<string>;
  memory: CentreCommandMemory;
  nowUt: number;
  /** The timeline epoch the view clock is in; a UT from an earlier epoch says nothing about this one. */
  epoch?: number;
}): {
  refusals: CommandRefusal[];
  failures: CommandFailure[];
  founds: CommandFound[];
} {
  const { command, queue, own, memory, nowUt, epoch = 0 } = args;
  if (memory.since === null || memory.sinceEpoch !== epoch) {
    memory.since = value("ut", nowUt);
    memory.sinceEpoch = epoch;
  }
  const listed = new Set<string>();
  for (const entry of queue?.settled ?? []) {
    if (entry.command !== command || own.has(entry.clientRequestId)) continue;
    const id = settledId(entry);
    listed.add(id);
    if (memory.outcomes.has(id) || entry.settledAt.lessThan(memory.since)) {
      continue;
    }
    const found = memory.unanswered.delete(id);
    // An answer on time is said by the row leaving; only a late one is news.
    if (entry.outcome === "answered" && !found) continue;
    memory.outcomes.set(id, { entry, dismissed: false, found });
  }
  let refusals = NO_REFUSALS;
  let failures = NO_FAILURES;
  let founds = NO_FOUNDS;
  for (const [id, { entry, dismissed, found }] of memory.outcomes) {
    if (dismissed) {
      if (!listed.has(id)) memory.outcomes.delete(id);
      continue;
    }
    const named = { id, command, args: undefined, label: entry.label };
    if (found) {
      if (founds === NO_FOUNDS) founds = [];
      founds.push(foundOf(named, entry));
      continue;
    }
    if (entry.outcome === "refused") {
      if (refusals === NO_REFUSALS) refusals = [];
      refusals.push({
        ...named,
        errorCode: entry.code as CommandErrorCode,
        reason: entry.reason ?? undefined,
        detail: entry.detail ?? undefined,
      });
      continue;
    }
    if (entry.outcome === "failed") {
      if (failures === NO_FAILURES) failures = [];
      failures.push({
        ...named,
        code: entry.code,
        reason: entry.message ?? "",
      });
    }
  }
  return { refusals, failures, founds };
}

function foundOf(
  named: { id: string; command: string; args: undefined; label: string },
  entry: SettledEntry,
): CommandFound {
  switch (entry.outcome) {
    case "refused":
      return {
        ...named,
        outcome: "refused",
        errorCode: entry.code as CommandErrorCode,
        reason: entry.reason ?? undefined,
        detail: entry.detail ?? undefined,
      };
    case "failed":
      return {
        ...named,
        outcome: "errored",
        error: { code: entry.code, message: entry.message ?? "" },
      };
    default:
      return { ...named, outcome: "ran", result: undefined };
  }
}

/** Hides a reported outcome; it is forgotten once the centre stops listing it. */
export function dismissCentreOutcome(
  memory: CentreCommandMemory,
  id: string,
): void {
  const kept = memory.outcomes.get(id);
  if (kept) kept.dismissed = true;
}

const SETTLED_PHASES: ReadonlySet<CommandStatus["phase"]> = new Set([
  "confirmed",
  "refused",
  "failed",
  "found",
  "undelivered",
]);

/**
 * The rail rows for every queued `command` this hook did not send: the same
 * command sent from another screen of the command centre, or from another
 * widget on this one. A row lasts while its entry is on the queue; one that is
 * lost or overdue there stays, as the sender's own loss does, until dismissed.
 *
 * `statusOf` is this screen's own record of the request, which a main screen
 * holds for every command a station relays through it. It settles a row the
 * queue alone cannot: answered, or judged lost.
 */
export function centreCommandRows(args: {
  command: string;
  queue: PendingUplinkQueueLike | undefined;
  own: ReadonlySet<string>;
  memory: CentreCommandMemory;
  nowUt: number;
  pathConnectedDuring: PathConnectedDuring;
  statusOf: (requestId: string) => CommandStatus | undefined;
}): InFlightCommand[] {
  const { command, queue, own, memory, nowUt, pathConnectedDuring, statusOf } =
    args;
  const present = new Set<string>();
  // A command the centre reports settled is over, however late it was.
  const settled = new Set((queue?.settled ?? []).map(settledId));
  for (const entry of queue?.pending ?? []) {
    if (entry.command !== command || sentBy(entry, own)) continue;
    const id = centreRowId(entry);
    present.add(id);
    memory.entries.set(id, { ...entry, id, label: rowLabel(entry) });
  }
  const rows: InFlightCommand[] = [];
  for (const [id, entry] of memory.entries) {
    const inQueue = present.has(id);
    const status = entry.clientRequestId
      ? statusOf(entry.clientRequestId)
      : undefined;
    const answered = status !== undefined && SETTLED_PHASES.has(status.phase);
    const judgedLost = status?.phase === "lost";
    let row = answered
      ? undefined
      : classifyRetained({
          entry,
          nowUt,
          present: inQueue,
          acknowledged: false,
          pathConnectedDuring,
        });
    if (row && judgedLost && row.predictedPhase !== "lost") {
      const { held: _held, hold: _hold, ...settled } = row;
      row = { ...settled, predictedPhase: "lost" };
    }
    const unanswered =
      row?.predictedPhase === "lost" || row?.predictedPhase === "overdue";
    if (!row || (!inQueue && (!unanswered || settled.has(id)))) {
      memory.entries.delete(id);
      memory.dismissed.delete(id);
      // Kept past the row while its outcome may still be on its way.
      if (!(unanswered && settled.has(id))) memory.unanswered.delete(id);
      continue;
    }
    if (unanswered) memory.unanswered.add(id);
    else memory.unanswered.delete(id);
    if (memory.dismissed.has(id)) {
      if (!inQueue) {
        memory.entries.delete(id);
        memory.dismissed.delete(id);
      }
      continue;
    }
    rows.push(row);
  }
  return rows;
}
