import { PerfBudget, safeRandomUuid } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import type { RadioFrame } from "./radio/wire";
import type {
  CommcastLogSnapshot,
  CommsAck,
  CommsMessage,
  CommsSendInput,
  OutboundMessage,
} from "./types";
import { EMPTY_COMMCAST_LOG } from "./types";

const STORAGE_PREFIX = "gonogo.commcast.v2.";

/**
 * How many messages one vantage keeps in each direction. Its own log, so the
 * cap bounds this screen's storage rather than anything on the wire: nothing
 * hands a whole log to anyone.
 */
const MAX_MESSAGES = 500;

/**
 * Transmissions per second from one screen. Commcast sends on COMMIT (one
 * frame per message or per acknowledgement), never per keystroke: at
 * `PEER_BROADCAST_BYTES_BUDGET`'s 200 kB/s a burst at typing rates would be
 * visible, and a sustained rate above this means something is retransmitting
 * in a loop, which the idempotent resend makes possible to get wrong.
 */
const COMMCAST_TRANSMIT_BUDGET = new PerfBudget({
  name: "CommcastLog transmissions/sec",
  threshold: 20,
  windowMs: 1000,
  unit: "messages",
});

type Listener = (snap: CommcastLogSnapshot) => void;

/** What the log hands to the mesh. Delivery is somebody else's problem. */
export interface CommcastTransmitter {
  transmit(msg: CommsMessage): void;
  acknowledge(ack: CommsAck): void;
  /**
   * Live radio, riding the same wire.
   *
   * Optional so a transmitter double in a test that has nothing to do with
   * audio stays two methods long, and so a mesh built before this existed keeps
   * compiling. `CommcastMesh` implements it.
   */
  radio?(frame: RadioFrame): void;
}

export interface CommcastLogOptions {
  /**
   * Which screen's log this is. Two screens on one browser (a host tab and a
   * station tab) are two vantages and must not share a log, which a single
   * storage key would silently make them do.
   */
  screenKey: string;
  /** Wall-clock ms, injectable for tests. */
  now?: () => number;
  storage?: Storage | undefined;
  transmitter?: CommcastTransmitter;
}

/**
 * What ONE vantage holds: the messages it sent and the messages that reached
 * it. There is no canonical thread anywhere and no host copy of anyone else's
 * log.
 *
 * That is the whole architecture, and it is what a host-authoritative store
 * gets wrong. A store on the command centre makes every message survive
 * everything, including the cases where the point of the feature is that it
 * did not: a craft with no path home, a station that was away, a message that
 * simply never arrived. Here a message exists at a vantage because it reached
 * that vantage, so two logs legitimately hold different SETS.
 *
 * The consequence the operator has to live with is that a message nobody
 * received is invisible to everyone except its author, who sees it
 * unconfirmed. That is not a gap in the design, it is the only honest report a
 * one-shot transmission can make, and it is why the acknowledgement is the
 * loss signal rather than merely delay decoration.
 */
export class CommcastLog {
  private outbox: OutboundMessage[] = [];
  private inbox: CommsMessage[] = [];
  /**
   * Heard on the wire and addressed here, but still crossing. Persisted with
   * the rest, so a refresh mid-crossing does not lose a message that was
   * genuinely on its way.
   */
  private pending: CommsMessage[] = [];
  private droppedCount = 0;
  private vantageId: string | undefined;
  private readonly listeners = new Set<Listener>();
  private readonly radioListeners = new Set<(frame: RadioFrame) => void>();
  private readonly now: () => number;
  private readonly storage: Storage | undefined;
  private readonly key: string;
  private transmitter: CommcastTransmitter | undefined;
  /** Which screen this log belongs to, the identity its acks are signed with. */
  readonly screenKey: string;

  constructor(opts: CommcastLogOptions) {
    this.screenKey = opts.screenKey;
    this.now = opts.now ?? (() => Date.now());
    this.storage =
      opts.storage ??
      (typeof localStorage === "undefined" ? undefined : localStorage);
    this.key = STORAGE_PREFIX + opts.screenKey;
    this.transmitter = opts.transmitter;
    this.load();
  }

  /**
   * Attach (or replace) the mesh this log transmits over. Separate from the
   * constructor because a screen's log outlives its peer connection: a log
   * that had to be rebuilt when the mesh reconnected would drop what it holds,
   * which is the one thing a vantage's own log must never do.
   */
  setTransmitter(transmitter: CommcastTransmitter | undefined): void {
    this.transmitter = transmitter;
  }

  /**
   * Put one live radio frame on the wire.
   *
   * Here rather than on a second provider because this object already owns the
   * mesh, and both ends of the app reach it: a host's log is built at screen
   * level with a `forHost` mesh, a station's in `CommcastProvider` with a
   * `forClient` one, and the widget holds whichever it got. A parallel context
   * would have to be threaded through both.
   *
   * It STORES nothing, and that is the difference from every other method on
   * this class. Radio is live: there is no transcript, a listener who was away
   * missed it, and keeping a copy here would be the recorded-audio-message
   * feature arriving by the back door.
   */
  sendRadio(frame: RadioFrame): void {
    this.transmitter?.radio?.(frame);
  }

  /** A radio frame off the wire, already stripped of this screen's own echo. */
  receiveRadio(frame: RadioFrame): void {
    for (const listener of this.radioListeners) listener(frame);
  }

  /** Listen to the radio channel. Nothing is replayed: there is no backlog. */
  onRadio(cb: (frame: RadioFrame) => void): () => void {
    this.radioListeners.add(cb);
    return () => {
      this.radioListeners.delete(cb);
    };
  }

  snapshot(): CommcastLogSnapshot {
    if (
      this.outbox.length === 0 &&
      this.inbox.length === 0 &&
      this.pending.length === 0 &&
      this.droppedCount === 0
    ) {
      return EMPTY_COMMCAST_LOG;
    }
    return {
      outbox: this.outbox,
      inbox: this.inbox,
      pending: this.pending,
      droppedCount: this.droppedCount,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Say something to whoever `input.to` names.
   *
   * A `separationSeconds` of `null` is NO PATH, and nothing is transmitted:
   * the message is kept, marked as never having left, and the operator can
   * resend when a path exists. Handing it to the mesh anyway would deliver it
   * over PeerJS at the speed of the internet, which is exactly the
   * faster-than-light channel the light-time model exists to model away.
   */
  send(
    author: {
      stationKey: string;
      name: string;
      seat: CommsMessage["authorSeat"];
      vantageId: string;
    },
    input: CommsSendInput,
  ): CommsMessage {
    const msg: CommsMessage = {
      id: safeRandomUuid(),
      to: [...input.to],
      from: author.vantageId,
      authorStationKey: author.stationKey,
      authorName: author.name,
      authorSeat: author.seat,
      sentUt: input.sentUt,
      lastSentUt: input.sentUt,
      attempts: 1,
      separationSeconds: input.separationSeconds,
      kind: input.kind,
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.authorVesselId === undefined
        ? {}
        : { authorVesselId: input.authorVesselId }),
    };
    const neverLeft = input.separationSeconds === null;
    this.pushOutbound({ msg, acks: [], neverLeft });
    if (!neverLeft) this.dispatch(msg);
    this.persistAndEmit();
    return msg;
  }

  /**
   * Transmit an already-sent message again, keeping its identity.
   *
   * ONE action, and it is a re-ask as much as a resend: the recipient dedupes
   * on the id, so either it already holds the message and acknowledges again,
   * which answers "did it arrive", or it does not and now does. A separate
   * query would cost the same two legs and buy nothing. (A later mode carrying
   * a recorded body would change that arithmetic, since re-sending audio is
   * genuinely expensive where a bare query is not. Text does not.)
   *
   * `sentUt` and the separation are re-stamped because the new attempt is a
   * new journey with its own acknowledgement window; the id, the first
   * `sentUt` and any acknowledgement already received are not, so a late reply
   * to the FIRST attempt still confirms the message and can never flip a
   * confirmed one back.
   */
  resend(
    messageId: string,
    atUt: number,
    separationSeconds: number | null,
  ): void {
    const found = this.outbox.find((o) => o.msg.id === messageId);
    if (!found) return;
    const msg: CommsMessage = {
      ...found.msg,
      lastSentUt: atUt,
      attempts: found.msg.attempts + 1,
      separationSeconds,
    };
    const neverLeft = separationSeconds === null;
    this.outbox = this.outbox.map((o) =>
      o.msg.id === messageId ? { ...o, msg, neverLeft } : o,
    );
    if (!neverLeft) this.dispatch(msg);
    this.persistAndEmit();
  }

  /**
   * Which vantage this log belongs to, so it can tell its own mail from
   * everyone else's.
   *
   * It arrives after construction because it comes off the first frame
   * (`useObservedVantage`), which is later than the log has to exist. Until
   * then the log accepts nothing from the wire, which is right: a screen that
   * does not yet know where it is standing cannot know what reached it.
   */
  setVantage(vantageId: string | undefined): void {
    this.vantageId = vantageId;
  }

  /**
   * A transmission this screen heard on the mesh.
   *
   * Kept only if it NAMES this vantage. Every frame passes every participant,
   * because the star topology gives no choice, and dropping other people's mail
   * unread here is what makes two vantages hold different message sets rather
   * than one shared set filtered at render time.
   *
   * Deduped on the message id across everything this log already holds, which
   * is what makes the resend idempotent: a resend whose original also arrived
   * is ONE message here. `false` says it was a duplicate, and the caller
   * acknowledges it anyway, because answering the second copy is exactly what
   * makes a resend a re-ask.
   */
  receiveTransmission(msg: CommsMessage): boolean {
    if (this.vantageId === undefined) return false;
    if (!msg.to.includes(this.vantageId)) return false;
    if (this.holds(msg.id)) return false;
    this.pending = [...this.pending, msg];
    this.persistAndEmit();
    return true;
  }

  /**
   * A held transmission has now crossed its separation: move it in front of
   * the operator and tell the author it landed.
   *
   * `atUt` is the instant it ARRIVED, not the instant this ran. A screen that
   * was closed for the crossing releases late in wall-clock and still
   * acknowledges at the true arrival, so the author's round trip reads the
   * geometry rather than the recipient's browsing habits.
   */
  release(id: string, ack: Omit<CommsAck, "messageId">): void {
    const msg = this.pending.find((m) => m.id === id);
    if (!msg) return;
    this.pending = this.pending.filter((m) => m.id !== id);
    this.inbox = capped([...this.inbox, msg], (n) => {
      this.droppedCount += n;
    });
    this.acknowledge({ ...ack, messageId: id });
    this.persistAndEmit();
  }

  /** Tell the author of a message that it landed here. */
  acknowledge(ack: CommsAck): void {
    COMMCAST_TRANSMIT_BUDGET.record();
    this.transmitter?.acknowledge(ack);
  }

  /**
   * An acknowledgement of something this screen sent.
   *
   * Recorded once per acknowledging station. A second one for the same station
   * (a duplicate frame, or an acknowledgement of a resent copy) is dropped
   * rather than appended, so a resend can never produce two confirmations of
   * one message.
   */
  receiveAck(ack: CommsAck): void {
    let changed = false;
    this.outbox = this.outbox.map((out) => {
      if (out.msg.id !== ack.messageId) return out;
      if (out.acks.some((a) => a.stationKey === ack.stationKey)) return out;
      changed = true;
      return { ...out, acks: [...out.acks, ack] };
    });
    if (changed) this.persistAndEmit();
  }

  /** Whether this log already holds `id` anywhere. */
  holds(id: string): boolean {
    return (
      this.inbox.some((m) => m.id === id) ||
      this.pending.some((m) => m.id === id) ||
      this.outbox.some((o) => o.msg.id === id)
    );
  }

  replaceForTesting(snapshot: Partial<CommcastLogSnapshot>): void {
    if (snapshot.outbox) this.outbox = [...snapshot.outbox];
    if (snapshot.inbox) this.inbox = [...snapshot.inbox];
    if (snapshot.pending) this.pending = [...snapshot.pending];
    this.persistAndEmit();
  }

  private dispatch(msg: CommsMessage): void {
    COMMCAST_TRANSMIT_BUDGET.record();
    this.transmitter?.transmit(msg);
  }

  private pushOutbound(entry: OutboundMessage): void {
    this.outbox = capped([...this.outbox, entry], (n) => {
      this.droppedCount += n;
    });
  }

  private persistAndEmit(): void {
    this.persist();
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        this.key,
        JSON.stringify({
          outbox: this.outbox,
          inbox: this.inbox,
          pending: this.pending,
          droppedCount: this.droppedCount,
        }),
      );
    } catch (err) {
      logger.warn("[commcast] failed to persist log", { err: String(err) });
    }
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return;
      const held = parsed as Partial<CommcastLogSnapshot>;
      this.inbox = (held.inbox ?? [])
        .filter(isCommsMessage)
        .slice(-MAX_MESSAGES);
      this.pending = (held.pending ?? [])
        .filter(isCommsMessage)
        .slice(-MAX_MESSAGES);
      this.outbox = (held.outbox ?? []).filter(isOutbound).slice(-MAX_MESSAGES);
      this.droppedCount =
        typeof held.droppedCount === "number" ? held.droppedCount : 0;
    } catch (err) {
      logger.warn("[commcast] failed to load log", { err: String(err) });
    }
  }
}

/** Drop-oldest at the cap, and COUNT it, so the log can say it forgot. */
function capped<T>(items: T[], onDrop: (n: number) => void): T[] {
  if (items.length <= MAX_MESSAGES) return items;
  onDrop(items.length - MAX_MESSAGES);
  return items.slice(-MAX_MESSAGES);
}

function isCommsMessage(value: unknown): value is CommsMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Partial<CommsMessage>;
  return (
    typeof m.id === "string" &&
    Array.isArray(m.to) &&
    typeof m.from === "string" &&
    typeof m.authorStationKey === "string" &&
    typeof m.authorName === "string" &&
    (m.authorSeat === "pilot" || m.authorSeat === "mission-control") &&
    typeof m.sentUt === "number" &&
    typeof m.lastSentUt === "number" &&
    typeof m.attempts === "number" &&
    (m.separationSeconds === null || typeof m.separationSeconds === "number") &&
    typeof m.kind === "string"
  );
}

function isOutbound(value: unknown): value is OutboundMessage {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Partial<OutboundMessage>;
  return (
    isCommsMessage(o.msg) &&
    Array.isArray(o.acks) &&
    typeof o.neverLeft === "boolean"
  );
}
