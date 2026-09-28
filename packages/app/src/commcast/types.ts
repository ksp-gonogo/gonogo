import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";

/**
 * Commcast: ADDRESSED text between the people flying one mission, with
 * light-time applied across the one separation the message actually crosses.
 *
 * It is not a broadcast and it has no canonical transcript. A message names who
 * it is for, travels to them, and is acknowledged back; both ends keep only
 * what reached them. Two vantages therefore hold genuinely different message
 * SETS, not merely different orders, and that is the feature rather than a
 * consistency bug to be fixed by a server.
 */

/**
 * Message modes. `members` is a change to a group's membership, carried and
 * delayed exactly like a message so it reaches each vantage after that
 * vantage's own light-time. Recorded audio and video are not built.
 */
export type CommsMessageKind = "text" | "members" | "audio" | "video";

/**
 * Who a message is for, or who it came from: a VANTAGE key, the same
 * vocabulary `SetVantage` and `commandCentre.roster` use (`"ground:<name>"`,
 * `"vessel:<guid>"`).
 *
 * A vantage rather than a person, because the separation is a property of
 * where somebody is standing and not of who they are: two operators at one
 * centre are one address, and the same person at a different centre is a
 * different one. It is also the key the separation ledger is already published
 * against, so no new geometry is needed to route a message.
 */
export type RecipientId = string;

export interface CommsMessage {
  /**
   * Stable for the life of the message, INCLUDING across a resend.
   *
   * This is the mechanism the single idempotent resend rests on rather than an
   * implementation detail: the recipient dedupes on it, so a resend whose
   * original also arrives is one message, and an acknowledgement of the first
   * copy confirms the second. Minted once by the author and never re-minted.
   */
  id: string;
  /** The group it is addressed to, which is the one thread it belongs to. */
  groupId: string;
  /**
   * The group's members as the author could see them at send, the author's
   * own vantage included so a colleague at the same centre holds the same
   * thread. A vantage not named here is not a recipient and never holds it.
   */
  to: readonly RecipientId[];
  /** The vantage it was spoken from, which is one half of its separation. */
  from: RecipientId;
  /** Stable device identity of the author, as `station-info.stationKey`. */
  authorStationKey: string;
  /** Display name resolved from `station-info`, never a bare peer id. */
  authorName: string;
  /** Which end of the light-path it was spoken from. */
  authorSeat: Seat;
  /**
   * The author's `utNowEstimate()` at the FIRST send: their own present, which
   * carries no delay term. NOT `confirmedEdgeUt()`, which is already a
   * light-time behind and would push the reveal out to a round trip.
   */
  sentUt: number;
  /**
   * The author's present at the LATEST transmission, equal to `sentUt` until a
   * resend. Every leg the strip draws is measured from this one, because a
   * resend starts a fresh journey with a fresh acknowledgement window; `sentUt`
   * stays put so the log can say when the thing was first said.
   */
  lastSentUt: number;
  /** How many times it has been transmitted. 1 until the operator resends. */
  attempts: number;
  /**
   * The longest one-way separation from the author to a member it had a path
   * to, frozen at the latest transmission, or `null` when it had a path to no
   * member at all (never a measured zero).
   *
   * The longest because it bounds the acknowledgement window: the farthest
   * member is the last one who could answer. Each RECEIVER resolves its own
   * separation from the published matrix and falls back to this, which is
   * only reached when the matrix is absent and every member then shares the
   * one path-home figure anyway.
   */
  separationSeconds: number | null;
  kind: CommsMessageKind;
  /** Text body. Present for `kind: "text"`. */
  body?: string;
  /** The group's whole membership after this change. Present for `kind: "members"`. */
  members?: readonly RecipientId[];
  /** Who this change brought in. Present for `kind: "members"`; on the change that opened the group it is everyone but the author. */
  added?: readonly RecipientId[];
  /**
   * The craft the author was aboard at send, as `"vessel:<guid>"`. Absent from
   * a mission-control author, and absent aboard until the page knows its own
   * vessel.
   */
  authorVesselId?: string;
}

/**
 * One end of a message's return leg: the recipient telling the author it
 * arrived.
 *
 * It is the delay UX and the LOSS SIGNAL in one. A vessel-to-vessel message
 * that never lands is invisible to everyone by construction, so the only
 * evidence available anywhere is the absence of this, at the author.
 */
export interface CommsAck {
  messageId: string;
  /** The acknowledging vantage, which is one half of the return separation. */
  from: RecipientId;
  stationKey: string;
  seat: Seat;
  /** The recipient's `utNowEstimate()` when the message landed in front of them. */
  atUt: number;
}

/**
 * One message this screen sent, and what has come back about it.
 *
 * The author's half of the ledger, and it lives here rather than on a host
 * because a vantage owns what reached IT. Nobody else's copy of this message
 * carries the acknowledgements, and nobody else's needs to.
 */
export interface OutboundMessage {
  msg: CommsMessage;
  /**
   * Acknowledgements as they were RECEIVED here, raw. Each still has to cross
   * the return leg before it may be read, which is `revealedAcks`' job: a
   * receipt shown the instant the recipient tapped would be a
   * faster-than-light channel hiding inside the UI.
   */
  acks: readonly CommsAck[];
  /**
   * Set when the author had no path to the recipient at the latest attempt, so
   * nothing was transmitted at all. Distinct from an unanswered message: this
   * one never left, and the operator is told so rather than watching a
   * countdown for something that is not travelling.
   */
  neverLeft: boolean;
}

/** What one vantage holds: what it sent, and what reached it. */
export interface CommcastLogSnapshot {
  outbox: readonly OutboundMessage[];
  inbox: readonly CommsMessage[];
  /**
   * Addressed here and still crossing. Held rather than shown: a message this
   * screen can read before it arrived would be the faster-than-light channel
   * the whole model exists to avoid, and the mesh delivers at the speed of the
   * internet.
   */
  pending: readonly CommsMessage[];
  /**
   * How many messages have been dropped off the front of each list to stay
   * under the cap, cumulative for this screen's lifetime.
   *
   * A log that forgets must SAY it forgot. Silently shortening a transcript
   * leaves an operator reading a gap as though nothing was said across it,
   * which is the one thing a comms log cannot do. The same claim the mod's own
   * recorder makes with `Meta.GapSinceUt` when its ring drops a sample.
   */
  droppedCount: number;
}

export const EMPTY_COMMCAST_LOG: CommcastLogSnapshot = {
  outbox: [],
  inbox: [],
  pending: [],
  droppedCount: 0,
};

/** What the author asks the log to send. The log stamps the rest. */
export interface CommsSendInput {
  kind: CommsMessageKind;
  body?: string;
  groupId: string;
  to: readonly RecipientId[];
  members?: readonly RecipientId[];
  added?: readonly RecipientId[];
  sentUt: number;
  separationSeconds: number | null;
  authorVesselId?: string;
}

/** Somebody a message can be addressed to. */
export interface CommsRecipient {
  id: RecipientId;
  name: string;
  /**
   * Whether a live participant is reading at this vantage. A roster entry
   * nobody is sitting at is still addressable, and the message will go
   * unacknowledged, which is an honest outcome rather than a reason to hide it.
   */
  staffed: boolean;
}
