import { PerfBudget, safeRandomUuid } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";
import type {
  CommcastSnapshot,
  CommsMessage,
  CommsParticipant,
  CommsSendInput,
} from "./types";
import { EMPTY_COMMCAST_SNAPSHOT } from "./types";

const STORAGE_KEY = "gonogo.commcast.v1";

/**
 * How many messages the thread keeps. A mission's transcript is worth
 * persisting across a refresh, and a peer that has been away for a whole
 * flight is handed the whole of it on connect, so the cap is what stops the
 * snapshot growing without bound on the wire.
 */
const MAX_MESSAGES = 500;

/**
 * Snapshot broadcasts per second. The thread sends on COMMIT (one broadcast
 * per message or per batch of read receipts), never per keystroke: at
 * `PEER_BROADCAST_BYTES_BUDGET`'s 200 kB/s a 50-message snapshot is a few
 * percent per send on that cadence and would trip it at typing rates. A
 * sustained rate over this means something is re-broadcasting in a loop.
 */
const COMMCAST_BROADCAST_BUDGET = new PerfBudget({
  name: "CommcastHostService snapshots/sec",
  threshold: 30,
  windowMs: 1000,
  unit: "messages",
});

type Listener = (snap: CommcastSnapshot) => void;

export interface CommcastHostOptions {
  /** Wall-clock ms, injectable for tests. */
  now?: () => number;
  /** Persisted thread, injectable for tests. */
  load?: () => CommsMessage[] | null;
  storage?: Storage;
}

/**
 * The canonical thread. Every participant's copy is a mirror of this one.
 *
 * Host-authoritative is forced rather than preferred: several pilots and
 * several command centres share ONE thread, and a participant's own copy dies
 * with the tab. What makes that survivable is the notes pattern's connect-time
 * push, so a message reaches someone who was away when it was spoken.
 *
 * The host does NOT gate reveal. Delay is per recipient (see `reveal.ts`), so
 * the canonical list holds everything and each seat decides for itself what has
 * reached it. That also means the host holding a message it cannot yet see is
 * normal, not a bug.
 */
export class CommcastHostService {
  private messages: CommsMessage[];
  private droppedCount = 0;
  private readonly listeners = new Set<Listener>();
  private readonly participants = new Map<string, CommsParticipant>();
  private readonly now: () => number;
  private readonly storage: Storage | undefined;

  constructor(opts: CommcastHostOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.storage =
      opts.storage ??
      (typeof localStorage === "undefined" ? undefined : localStorage);
    this.messages = opts.load ? (opts.load() ?? []) : this.loadFromStorage();
  }

  snapshot(): CommcastSnapshot {
    return this.messages.length === 0 && this.droppedCount === 0
      ? EMPTY_COMMCAST_SNAPSHOT
      : { messages: this.messages, droppedCount: this.droppedCount };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Append one message, from whoever said it. The operator at this screen and
   * a peer both arrive here, and the author is passed in either way rather than
   * resolved from the connection.
   *
   * The author's SEAT and stationKey ride on the wire rather than being looked
   * up here: a message whose seat the host could not resolve could not be
   * reveal-gated at all, and the seat is exactly what arrives late when a peer
   * connects and speaks in the same breath. Only the display NAME is resolved
   * here, and patched by `noteParticipant` when it lands.
   */
  post(author: CommsParticipant, input: CommsSendInput): CommsMessage {
    return this.append(this.resolveName(author), input);
  }

  private append(
    author: CommsParticipant,
    input: CommsSendInput,
  ): CommsMessage {
    const msg: CommsMessage = {
      id: safeRandomUuid(),
      authorStationKey: author.stationKey,
      authorName: author.name,
      authorSeat: author.seat,
      sentUt: input.sentUt,
      oneWaySeconds: input.oneWaySeconds,
      kind: input.kind,
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.authorVesselId === undefined
        ? {}
        : { authorVesselId: input.authorVesselId }),
      ...((input.authorVantageId ?? author.vantageId)
        ? { authorVantageId: input.authorVantageId ?? author.vantageId }
        : {}),
      receivedAtMs: this.now(),
      readBy: [],
    };
    const next = [...this.messages, msg];
    // Drop-oldest at the cap, and COUNT it. A transcript that quietly shortens
    // itself reads as though nothing was said across the gap.
    if (next.length > MAX_MESSAGES) {
      this.droppedCount += next.length - MAX_MESSAGES;
    }
    this.messages = next.slice(-MAX_MESSAGES);
    this.persistAndEmit();
    return msg;
  }

  /**
   * Record that `reader` has read each of `messageIds` at their own `atUt`.
   * The receipt is delayed back across the same separation when it renders
   * (see `receiptRevealUt`), so this is the raw fact, not the visible one.
   */
  markRead(
    reader: CommsParticipant,
    messageIds: readonly string[],
    atUt: number,
  ): void {
    const wanted = new Set(messageIds);
    let changed = false;
    this.messages = this.messages.map((msg) => {
      if (!wanted.has(msg.id)) return msg;
      if (msg.readBy.some((r) => r.stationKey === reader.stationKey))
        return msg;
      changed = true;
      return {
        ...msg,
        readBy: [
          ...msg.readBy,
          {
            stationKey: reader.stationKey,
            seat: reader.seat,
            ...(reader.vantageId === undefined
              ? {}
              : { vantageId: reader.vantageId }),
            atUt,
          },
        ],
      };
    });
    if (changed) this.persistAndEmit();
  }

  /**
   * Learn (or re-learn) who a participant is. Messages that landed before
   * their `station-info` did carry a placeholder name; patch those, because
   * "from the ground" and "from nobody" must not be the same value.
   */
  noteParticipant(participant: CommsParticipant): void {
    const known = this.participants.get(participant.stationKey);
    this.participants.set(participant.stationKey, participant);
    if (known?.name === participant.name) return;
    let patched = false;
    this.messages = this.messages.map((msg) => {
      if (msg.authorStationKey !== participant.stationKey) return msg;
      if (msg.authorName === participant.name) return msg;
      patched = true;
      return { ...msg, authorName: participant.name };
    });
    if (patched) this.persistAndEmit();
  }

  /** Everyone the host has ever been told about this session. */
  knownParticipants(): readonly CommsParticipant[] {
    return [...this.participants.values()];
  }

  replaceForTesting(messages: readonly CommsMessage[]): void {
    this.messages = [...messages];
    this.persistAndEmit();
  }

  private resolveName(author: CommsParticipant): CommsParticipant {
    if (author.name.trim()) {
      this.participants.set(author.stationKey, author);
      return author;
    }
    const known = this.participants.get(author.stationKey);
    return { ...author, name: known?.name ?? seatLabel(author.seat) };
  }

  private persistAndEmit(): void {
    this.persistToStorage();
    COMMCAST_BROADCAST_BUDGET.record();
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  private persistToStorage(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.messages));
    } catch (err) {
      logger.warn("[commcast] failed to persist thread", { err: String(err) });
    }
  }

  private loadFromStorage(): CommsMessage[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isCommsMessage).slice(-MAX_MESSAGES);
    } catch (err) {
      logger.warn("[commcast] failed to load thread", { err: String(err) });
      return [];
    }
  }
}

/** Placeholder author for a peer that has not sent its `station-info` yet. */
export function seatLabel(seat: Seat): string {
  return seat === "pilot" ? "Pilot" : "Mission Control";
}

function isCommsMessage(value: unknown): value is CommsMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Partial<CommsMessage>;
  return (
    typeof m.id === "string" &&
    typeof m.authorStationKey === "string" &&
    typeof m.authorName === "string" &&
    (m.authorSeat === "pilot" || m.authorSeat === "mission-control") &&
    typeof m.sentUt === "number" &&
    (m.oneWaySeconds === null || typeof m.oneWaySeconds === "number") &&
    typeof m.kind === "string" &&
    typeof m.receivedAtMs === "number" &&
    Array.isArray(m.readBy)
  );
}
