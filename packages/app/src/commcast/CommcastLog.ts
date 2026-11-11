import { PerfBudget, safeRandomUuid } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import type { HeardRadioFrame, RadioFrame } from "./radio/wire";
import type {
  CommcastLogSnapshot,
  CommsAck,
  CommsMessage,
  CommsSendInput,
  Delivery,
  LedgerItem,
  OutboundMessage,
  RecipientId,
} from "./types";
import { EMPTY_COMMCAST_LOG } from "./types";

const STORAGE_PREFIX = "gonogo.commcast.v4.";

/**
 * How many messages one vantage keeps in each direction. Its own log, so the
 * cap bounds this screen's storage rather than anything on the wire: nothing
 * hands a whole log to anyone.
 */
const MAX_MESSAGES = 500;

/**
 * Transmissions per second from one screen. Commcast sends on commit (one
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

/** An acknowledgement this screen sends. The mod stamps when it was made, and when it arrives. */
export type OutgoingAck = Omit<CommsAck, "atUt" | "arrivedUt">;

/** What the log hands its words to. Delivery is somebody else's problem. */
export interface CommcastTransmitter {
  /**
   * `to` names who a resend is for when it is not the whole group; absent
   * means everyone the speaker knows.
   */
  transmit(msg: CommsMessage, to?: readonly RecipientId[]): void;
  acknowledge(ack: OutgoingAck): void;
  /** Live radio. Optional so a transmitter double with nothing to do with audio stays two methods long. */
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
 * What one vantage holds: the messages it sent and the messages that reached
 * it. There is no canonical thread anywhere and no host copy of anyone else's
 * log.
 *
 * That is the whole architecture, and it is what a host-authoritative store
 * gets wrong. A store on the command centre makes every message survive
 * everything, including the cases where the point of the feature is that it
 * did not: a craft with no path home, a station that was away, a message that
 * simply never arrived. Here a message exists at a vantage because it reached
 * that vantage, so two logs legitimately hold different sets.
 *
 * The consequence the operator has to live with is that a message nobody
 * received is invisible to everyone except its author, who sees it
 * unconfirmed. That is not a gap in the design, it is the only honest report a
 * one-shot transmission can make, and it is why the acknowledgement is the
 * loss signal rather than merely delay decoration.
 */
/** The most deliveries held while the vantage is unknown, which is only the instant between the subscribe and the first frame. */
const AWAITING_VANTAGE_CAP = 200;

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
  /** Per group, the newest `receivedSeq` shown to the operator. */
  private readThrough: Record<string, number> = {};
  private nextReceivedSeq = 1;
  private vantageId: string | undefined;
  /** What the wire delivered before the vantage was known, judged once it is. */
  private awaitingVantage: CommsMessage[] = [];
  /** How long a message from this vantage takes to reach a recipient, as this screen can tell: null for none, undefined for no way of telling. */
  private separationOf:
    | ((to: RecipientId) => number | null | undefined)
    | undefined;
  /** The latest ledger the wire delivered before the vantage was known. */
  private awaitingLedger: readonly LedgerItem[] | undefined;
  private readonly listeners = new Set<Listener>();
  private readonly radioListeners = new Set<(frame: HeardRadioFrame) => void>();
  private readonly radioRefusalListeners = new Set<(reason?: string) => void>();
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
   * Attach (or replace) what this log transmits through. Separate from the
   * constructor because a screen's log outlives its connection: a log that had
   * to be rebuilt when the link reconnected would drop what it holds, which is
   * the one thing a vantage's own log must never do.
   */
  setTransmitter(transmitter: CommcastTransmitter | undefined): void {
    this.transmitter = transmitter;
  }

  /**
   * Put one live radio frame on the wire.
   *
   * It stores nothing, and that is the difference from every other method on
   * this class. Radio is live: there is no transcript, a listener who was away
   * missed it, and keeping a copy here would be the recorded-audio-message
   * feature arriving by the back door.
   */
  sendRadio(frame: RadioFrame): void {
    this.transmitter?.radio?.(frame);
  }

  /** The mod refused a radio frame this screen sent, so what was said is not going out. */
  refuseRadio(reason?: string): void {
    for (const listener of this.radioRefusalListeners) listener(reason);
  }

  /** Listen for the mod refusing this screen's own radio frames. */
  onRadioRefused(cb: (reason?: string) => void): () => void {
    this.radioRefusalListeners.add(cb);
    return () => {
      this.radioRefusalListeners.delete(cb);
    };
  }

  /** A radio frame as the mod delivered it, this screen's own voice already dropped. */
  receiveRadio(frame: HeardRadioFrame): void {
    for (const listener of this.radioListeners) listener(frame);
  }

  /** Listen to the radio channel. Nothing is replayed: there is no backlog. */
  onRadio(cb: (frame: HeardRadioFrame) => void): () => void {
    this.radioListeners.add(cb);
    return () => {
      this.radioListeners.delete(cb);
    };
  }

  /**
   * What this screen holds at the vantage it is standing at now. One stored log
   * serves every centre the screen sits at, so mail for another centre stays
   * stored and is not shown here; before the vantage is known everything is.
   */
  snapshot(): CommcastLogSnapshot {
    const here = this.vantageId;
    const outbox =
      here === undefined
        ? this.outbox
        : this.outbox.filter((o) => o.msg.from === here);
    const inbox =
      here === undefined
        ? this.inbox
        : this.inbox.filter((m) => m.to.includes(here));
    const pending =
      here === undefined
        ? this.pending
        : this.pending.filter((m) => m.to.includes(here));
    if (
      outbox.length === 0 &&
      inbox.length === 0 &&
      pending.length === 0 &&
      this.droppedCount === 0
    ) {
      return EMPTY_COMMCAST_LOG;
    }
    return {
      outbox,
      inbox,
      pending,
      droppedCount: this.droppedCount,
      readThrough: this.readThrough,
    };
  }

  /** The operator has the group's thread in front of them: everything received in it so far is read. */
  markRead(groupId: string): void {
    let newest = this.readThrough[groupId] ?? 0;
    for (const m of this.inbox) {
      if (m.groupId === groupId && (m.receivedSeq ?? 0) > newest) {
        newest = m.receivedSeq ?? 0;
      }
    }
    if (newest === (this.readThrough[groupId] ?? 0)) return;
    this.readThrough = { ...this.readThrough, [groupId]: newest };
    this.persistAndEmit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Say something to whoever `input.to` names.
   *
   * A separation of `null` is "NO PATH" to that recipient: its delivery is
   * queued, with no countdown, because the mod keeps the words until a path
   * opens. The message is always transmitted; the mod's receipt says who it
   * left for, who is waiting and who it could not reach.
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
    // A membership change asks nothing of anyone: it is settled for its author the moment it is made.
    const deliveries =
      input.kind === "members"
        ? []
        : [...input.separations].map(
            ([to, separationSeconds]): Delivery => ({
              to,
              separationSeconds,
              lastSentUt: input.sentUt,
              attempts: 1,
              neverLeft: false,
              ...(separationSeconds === null ? { queued: true } : {}),
            }),
          );
    const msg: CommsMessage = {
      id: safeRandomUuid(),
      groupId: input.groupId,
      to: [...input.to],
      from: author.vantageId,
      authorStationKey: author.stationKey,
      authorName: author.name,
      authorSeat: author.seat,
      sentUt: input.sentUt,
      lastSentUt: input.sentUt,
      attempts: 1,
      separationSeconds: longestOf(deliveries),
      kind: input.kind,
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.members === undefined ? {} : { members: [...input.members] }),
      ...(input.added === undefined ? {} : { added: [...input.added] }),
      ...(input.authorVesselId === undefined
        ? {}
        : { authorVesselId: input.authorVesselId }),
    };
    this.pushOutbound({ msg, acks: [], deliveries });
    this.dispatch(msg);
    this.persistAndEmit();
    return msg;
  }

  /**
   * Transmit an already-sent message again to `recipients`, keeping its
   * identity.
   *
   * One action, and it is a re-ask as much as a resend: the recipient dedupes
   * on the id, so either it already holds the message and acknowledges again,
   * which answers "did it arrive", or it does not and now does. A separate
   * query would cost the same two legs and buy nothing. (A later mode carrying
   * a recorded body would change that arithmetic, since re-sending audio is
   * genuinely expensive where a bare query is not. Text does not.)
   *
   * Only the named recipients' deliveries are re-stamped, each with its own
   * fresh separation and acknowledgement window; the id, the first `sentUt`
   * and any acknowledgement already received are not, so a late reply to the
   * first attempt still confirms its recipient and can never flip a confirmed
   * one back.
   */
  resend(
    messageId: string,
    recipients: readonly RecipientId[],
    atUt: number,
    separations: ReadonlyMap<RecipientId, number | null>,
  ): void {
    const found = this.outbox.find((o) => o.msg.id === messageId);
    if (!found) return;
    const deliveries = found.deliveries.map((d): Delivery => {
      if (!recipients.includes(d.to)) return d;
      const separationSeconds = separations.get(d.to) ?? null;
      const {
        refused: _refused,
        refusedReason: _reason,
        queued: _queued,
        ...kept
      } = d;
      return {
        ...kept,
        separationSeconds,
        lastSentUt: atUt,
        attempts: d.attempts + 1,
        neverLeft: false,
        ...(separationSeconds === null ? { queued: true } : {}),
      };
    });
    const msg: CommsMessage = {
      ...found.msg,
      lastSentUt: atUt,
      attempts: found.msg.attempts + 1,
      separationSeconds: longestOf(deliveries),
    };
    this.outbox = this.outbox.map((o) =>
      o.msg.id === messageId ? { ...o, msg, deliveries } : o,
    );
    const leaving = deliveries
      .filter((d) => recipients.includes(d.to))
      .map((d) => d.to);
    if (leaving.length > 0) this.dispatch(msg, leaving);
    this.persistAndEmit();
  }

  /**
   * What the mod says a send did: who it left for, who it is keeping the
   * message for until a path opens, and who it could not reach at all.
   *
   * The mod knows whether a route existed, which this screen only estimates,
   * so a member it names queued is waiting for a path and one it names
   * unreached is never-left, whatever the estimate said. An addressed member
   * is left as it was: arrival is for its own acknowledgement to say.
   */
  recordReceipt(
    messageId: string,
    addressed: readonly RecipientId[],
    unreached: readonly RecipientId[],
    queued: readonly RecipientId[] = [],
  ): void {
    const found = this.outbox.find((o) => o.msg.id === messageId);
    if (!found) return;
    const changes = (d: Delivery) =>
      (unreached.includes(d.to) && !d.neverLeft) ||
      (queued.includes(d.to) && !d.queued) ||
      (addressed.includes(d.to) && !d.delivered);
    if (!found.deliveries.some(changes)) return;
    const deliveries = found.deliveries.map((d): Delivery => {
      if (unreached.includes(d.to)) {
        const { queued: _queued, ...rest } = d;
        return { ...rest, neverLeft: true };
      }
      if (queued.includes(d.to))
        return { ...d, queued: true, neverLeft: false };
      if (addressed.includes(d.to)) {
        const { queued: _queued, ...rest } = d;
        return { ...rest, delivered: true };
      }
      return d;
    });
    this.outbox = this.outbox.map((o) =>
      o.msg.id === messageId ? { ...o, deliveries } : o,
    );
    this.persistAndEmit();
  }

  /**
   * The mod refused a send outright: every delivery of the message that has
   * not been answered is marked refused, so the log says it was not sent
   * rather than waiting for an answer that cannot come.
   */
  recordRefusal(messageId: string, reason?: string): void {
    const found = this.outbox.find((o) => o.msg.id === messageId);
    if (!found || found.deliveries.length === 0) return;
    const deliveries = found.deliveries.map((d) =>
      d.refused
        ? d
        : {
            ...d,
            refused: true,
            ...(reason === undefined ? {} : { refusedReason: reason }),
          },
    );
    this.outbox = this.outbox.map((o) =>
      o.msg.id === messageId ? { ...o, deliveries } : o,
    );
    this.persistAndEmit();
  }

  /**
   * Everyone any membership change this log holds put in the group, whether or
   * not word of it has landed, so a group the mod has forgotten can be opened
   * again with the members it had.
   */
  membersOfGroup(groupId: string): RecipientId[] {
    const members = new Set<RecipientId>();
    for (const msg of [
      ...this.outbox.map((o) => o.msg),
      ...this.inbox,
      ...this.pending,
    ]) {
      if (msg.groupId !== groupId || msg.kind !== "members") continue;
      for (const member of msg.members ?? []) members.add(member);
      for (const member of msg.added ?? []) members.add(member);
    }
    return [...members].sort();
  }

  /**
   * Which vantage this log belongs to, so it can tell its own mail from
   * everyone else's.
   *
   * It arrives after construction because it comes off the first frame
   * (`useObservedVantage`), which is later than the log has to exist. Until
   * then it cannot judge what reached it, so what the wire delivers is kept
   * aside and judged the moment the vantage is known: the mod replays a
   * group's membership once, on subscribe, and a replay that arrived first
   * would otherwise be lost for good.
   */
  setVantage(vantageId: string | undefined): void {
    const moved = this.vantageId !== vantageId;
    this.vantageId = vantageId;
    if (moved) this.emit();
    if (
      vantageId === undefined ||
      (this.awaitingVantage.length === 0 && this.awaitingLedger === undefined)
    ) {
      return;
    }
    const waiting = this.awaitingVantage;
    this.awaitingVantage = [];
    for (const msg of waiting) this.receiveTransmission(msg);
    const ledger = this.awaitingLedger;
    this.awaitingLedger = undefined;
    if (ledger) this.applyLedger(ledger);
  }

  /**
   * A message the mod delivered here.
   *
   * Kept only if it names this vantage, and deduped on the message id across
   * everything this log already holds, which is what makes the resend
   * idempotent: a resend whose original also arrived is one message here.
   * `false` says it was a duplicate or not addressed here. A duplicate of a
   * message already read is answered with its acknowledgement again, since a
   * resend exists because the first one never reached the author.
   *
   * A text message said by another screen at this same vantage is this
   * vantage's own outgoing mail, not a message received: it is kept in the
   * outbox with a delivery to each recipient timed by `oneWaySeconds`, so every
   * screen at the vantage draws it crossing and settles on the same
   * acknowledgements. It is never read here and never acknowledged from here.
   */
  receiveTransmission(msg: CommsMessage): boolean {
    if (this.vantageId === undefined) {
      if (this.awaitingVantage.length < AWAITING_VANTAGE_CAP) {
        this.awaitingVantage.push(msg);
      }
      return false;
    }
    if (!msg.to.includes(this.vantageId)) return false;
    if (this.holds(msg.id)) return false;
    this.pending = [
      ...this.pending,
      { ...msg, receivedSeq: this.nextReceivedSeq++ },
    ];
    this.persistAndEmit();
    return true;
  }

  /** Gives the log a way to time a colleague's message to each recipient, from the separations this screen reads. */
  setSeparations(
    separationOf: ((to: RecipientId) => number | null | undefined) | undefined,
  ): void {
    this.separationOf = separationOf;
    if (separationOf && this.timeColleaguesMessages()) this.persistAndEmit();
  }

  /**
   * A colleague's message filed before this screen could time it is timed now,
   * by the separations it has since read. True when any changed.
   */
  private timeColleaguesMessages(): boolean {
    let changed = false;
    this.outbox = this.outbox.map((out) => {
      if (out.msg.authorStationKey === this.screenKey) return out;
      let touched = false;
      const deliveries = out.deliveries.map((d): Delivery => {
        if (!d.queued || d.delivered || d.refused) return d;
        const separation = this.separationOf?.(d.to);
        if (typeof separation !== "number") return d;
        touched = true;
        const { queued: _queued, ...rest } = d;
        return { ...rest, separationSeconds: separation };
      });
      if (!touched) return out;
      changed = true;
      return { ...out, deliveries };
    });
    return changed;
  }

  /**
   * This vantage's ledger, as the mod published it: what reached it and what it
   * said, with how each recipient stands.
   *
   * What reached it is handed to {@link receiveTransmission}, which keeps what it
   * does not already hold, so the same ledger said again changes nothing. What
   * it said is this vantage's own outgoing mail whichever screen said it: a
   * screen that did not say it files it as outgoing, and every screen settles it
   * on what the ledger says of each recipient.
   */
  applyLedger(items: readonly LedgerItem[], deliveredAt?: number): void {
    const here = this.vantageId;
    if (here === undefined) {
      this.awaitingLedger = items;
      return;
    }
    let changed = false;
    for (const item of items) {
      if (item.arrivedUt !== undefined) {
        if (item.to.includes(here)) {
          this.receiveTransmission(messageOf(item, item.arrivedUt));
        }
        continue;
      }
      if (item.from !== here) continue;
      if (item.kind === "members") {
        // A colleague's membership change is held as the group's, like any heard; our own is already held.
        if (item.author.stationKey !== this.screenKey) {
          this.receiveTransmission(messageOf(item, item.sentUt));
        }
        continue;
      }
      if (this.settleOutgoing(item, deliveredAt)) changed = true;
    }
    if (changed) this.persistAndEmit();
  }

  /** Files an outgoing text this screen did not say, if it is new, and settles each recipient on the ledger. True when anything changed. */
  private settleOutgoing(item: LedgerItem, deliveredAt?: number): boolean {
    let found = this.outbox.find((o) => o.msg.id === item.id);
    let changed = false;
    if (!found) {
      const msg = messageOf(item, undefined);
      found = {
        msg,
        acks: [],
        deliveries: item.to
          .filter((to) => to !== item.from)
          .map((to): Delivery => {
            const separationSeconds = this.separationOf?.(to) ?? null;
            return {
              to,
              separationSeconds,
              lastSentUt: item.sentUt,
              attempts: 1,
              neverLeft: false,
              ...(separationSeconds === null ? { queued: true } : {}),
            };
          }),
      };
      this.pushOutbound(found);
      changed = true;
    }
    const acks = [...found.acks];
    for (const [centre, read] of Object.entries(item.read)) {
      if (acks.some((a) => a.stationKey === read.stationKey)) continue;
      acks.push({
        messageId: item.id,
        from: centre,
        stationKey: read.stationKey,
        seat: read.seat,
        atUt: read.at,
        // The notice reached here when this ledger did; a screen that is only now told of it has no better figure than when it was read.
        arrivedUt: deliveredAt ?? read.at,
      });
    }
    const deliveries = found.deliveries.map((d): Delivery => {
      const ended = item.ended[d.to];
      if (ended !== undefined) {
        if (d.refused && d.refusedReason === ended) return d;
        const { queued: _queued, ...rest } = d;
        return { ...rest, refused: true, refusedReason: ended };
      }
      const landed = item.delivered[d.to];
      if (landed !== undefined && !d.delivered) {
        const { queued: _queued, ...rest } = d;
        return {
          ...rest,
          delivered: true,
          // The reply reached here at `landed`, a round trip after it was sent.
          separationSeconds:
            d.separationSeconds ?? Math.max(0, (landed - d.lastSentUt) / 2),
        };
      }
      return d;
    });
    const deliveriesChanged = deliveries.some(
      (d, i) => d !== found.deliveries[i],
    );
    if (!changed && !deliveriesChanged && acks.length === found.acks.length) {
      return false;
    }
    this.outbox = this.outbox.map((o) =>
      o.msg.id === item.id ? { ...o, deliveries, acks } : o,
    );
    return true;
  }

  /**
   * Move a message that has arrived in front of the operator, and tell the
   * author it landed.
   *
   * A screen at the author's own vantage does not answer. It crossed nothing,
   * and an instant answer from a colleague at the same centre would confirm a
   * message that is still on its way to everyone it had to travel to. A text
   * message from a colleague never reaches here at all: the ledger holds it as
   * outgoing.
   */
  release(id: string, ack: Omit<OutgoingAck, "messageId">): void {
    const msg = this.pending.find((m) => m.id === id);
    if (!msg) return;
    this.pending = this.pending.filter((m) => m.id !== id);
    this.inbox = capped([...this.inbox, msg], (n) => {
      this.droppedCount += n;
    });
    if (ack.from !== msg.from && msg.kind !== "members") {
      this.acknowledge({ ...ack, messageId: id });
    }
    this.persistAndEmit();
  }

  /** Tell the author of a message that it landed here. */
  acknowledge(ack: OutgoingAck): void {
    COMMCAST_TRANSMIT_BUDGET.record();
    this.transmitter?.acknowledge(ack);
  }

  /**
   * An acknowledgement of something this screen sent.
   *
   * Recorded once per acknowledging station, and only from a vantage the
   * message was addressed to. A second one for the same station (a duplicate
   * frame, or an acknowledgement of a resent copy) is dropped rather than
   * appended, so a resend can never produce two confirmations of one message.
   */
  receiveAck(ack: CommsAck): void {
    let changed = false;
    this.outbox = this.outbox.map((out) => {
      if (out.msg.id !== ack.messageId) return out;
      if (!out.deliveries.some((d) => d.to === ack.from)) return out;
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

  private dispatch(msg: CommsMessage, to?: readonly RecipientId[]): void {
    COMMCAST_TRANSMIT_BUDGET.record();
    this.transmitter?.transmit(msg, to);
  }

  private pushOutbound(entry: OutboundMessage): void {
    this.outbox = capped([...this.outbox, entry], (n) => {
      this.droppedCount += n;
    });
  }

  private persistAndEmit(): void {
    this.persist();
    this.emit();
  }

  private emit(): void {
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
          readThrough: this.readThrough,
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
      this.readThrough =
        typeof held.readThrough === "object" && held.readThrough !== null
          ? { ...held.readThrough }
          : {};
      for (const m of [...this.inbox, ...this.pending]) {
        this.nextReceivedSeq = Math.max(
          this.nextReceivedSeq,
          (m.receivedSeq ?? 0) + 1,
        );
      }
    } catch (err) {
      logger.warn("[commcast] failed to load log", { err: String(err) });
    }
  }
}

/** The longest separation among the deliveries that have a path, or `null` when none does. */
function longestOf(deliveries: readonly Delivery[]): number | null {
  let longest: number | null = null;
  for (const d of deliveries) {
    if (d.separationSeconds === null) continue;
    if (longest === null || d.separationSeconds > longest)
      longest = d.separationSeconds;
  }
  return longest;
}

/** Drop-oldest at the cap, and count it, so the log can say it forgot. */
function capped<Entry>(items: Entry[], onDrop: (n: number) => void): Entry[] {
  if (items.length <= MAX_MESSAGES) return items;
  onDrop(items.length - MAX_MESSAGES);
  return items.slice(-MAX_MESSAGES);
}

function isCommsMessage(value: unknown): value is CommsMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Partial<CommsMessage>;
  return (
    typeof m.id === "string" &&
    typeof m.groupId === "string" &&
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
    Array.isArray(o.deliveries)
  );
}

/** A ledger entry as a message held in a log: said at `arrivedUt` here, or by this vantage itself when that is undefined. */
function messageOf(
  item: LedgerItem,
  arrivedUt: number | undefined,
): CommsMessage {
  return {
    id: item.id,
    groupId: item.groupId,
    to: [...item.to],
    from: item.from,
    authorStationKey: item.author.stationKey,
    authorName: item.author.name,
    authorSeat: item.author.seat,
    sentUt: item.sentUt,
    lastSentUt: item.sentUt,
    attempts: 1,
    separationSeconds:
      arrivedUt === undefined ? null : Math.max(0, arrivedUt - item.sentUt),
    kind: item.kind,
    ...(arrivedUt === undefined ? {} : { arrivedUt }),
    ...(item.body === undefined ? {} : { body: item.body }),
    ...(item.members === undefined ? {} : { members: [...item.members] }),
    ...(item.added === undefined ? {} : { added: [...item.added] }),
  };
}
