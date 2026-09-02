import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";

/**
 * Commcast: the shared text thread between everyone flying one mission, with
 * light-time applied per RECIPIENT rather than per message.
 *
 * The thread is host-authoritative on the same pattern as mission notes: the
 * host holds the canonical list and broadcasts a full snapshot on change, and
 * pushes one to each peer as it connects so a message survives the recipient
 * being away for a whole flight. What it deliberately does NOT copy from notes
 * is notes' ordering (a manual drag index), its authorship (an optional raw
 * peer id that host edits omit), and its delete (anyone, immediately, for
 * everyone). A thread orders by time, names its author, and cannot un-say
 * something already revealed at another seat.
 */

/** Message modes. Only text exists; recorded audio and video are the next two. */
export type CommsMessageKind = "text" | "audio" | "video";

/**
 * Commcast carries no recipient, deliberately. One message goes to every
 * vantage: a command centre can speak to another centre, a pilot to another
 * pilot, either across, and a craft that does not exist yet joins the same
 * thread without a protocol change. What varies per reader is only WHEN it
 * arrives, which each reader works out from where and when it was spoken.
 */

export interface CommsMessage {
  id: string;
  /** Stable device identity of the author, as `station-info.stationKey`. */
  authorStationKey: string;
  /** Display name resolved from `station-info`, never a bare peer id. */
  authorName: string;
  /** Which end of the light-path it was spoken from. */
  authorSeat: Seat;
  /**
   * The vantage the author's session was OBSERVING at when they spoke
   * (`useObservedVantage()`), or absent when no frame had arrived yet.
   *
   * The seat alone answers "how far apart are we" for pilot-versus-ground and
   * gets two command centres at different vantages wrong, since they share one
   * seat. This is what separates those, and it is why the reveal keys on the
   * vantage with the seat as the coarse axis rather than the other way round.
   */
  authorVantageId?: string;
  /**
   * The author's `utNowEstimate()` at send: their own present, which carries
   * no delay term. NOT `confirmedEdgeUt()`, which is already a light-time
   * behind and would push the reveal out to `sentUt + 2 x delay`.
   */
  sentUt: number;
  /**
   * The author's own path home at send, frozen, or `null` for NO PATH (never a
   * measured zero).
   *
   * NOT the separation to any particular reader. Commcast is a broadcast and no
   * sender can know its distance to every receiver, so the general answer is
   * the published pair matrix resolved by each reader against
   * `authorVantageId`. This is the ONE pair `comms.delay` measures, craft to
   * ground, and it is the headline case, so it stands in wherever the matrix
   * has not reached the pair. It goes when the matrix covers everything.
   *
   * Frozen at send for the sender's own reading; the RECEIVER separately pins
   * the separation it resolves the first time it resolves it, so a delay that
   * changes afterwards can never un-deliver something already shown.
   */
  oneWaySeconds: number | null;
  kind: CommsMessageKind;
  /** Text body. Present for `kind: "text"`. */
  body?: string;
  /**
   * The craft the author was aboard at send, as `"vessel:<guid>"`. Absent from
   * a mission-control author, and absent aboard until the page knows its own
   * vessel. A recipient whose active craft has changed under a message still
   * in flight renders it on its OLD stamp and says so, rather than dropping it
   * or restamping it against a separation that was never true of it.
   */
  authorVesselId?: string;
  /** Wall-clock ms at the host, for a stable tiebreak on identical `sentUt`. */
  receivedAtMs: number;
  /** Who has read it, and when they read it in their own UT. */
  readBy: readonly CommsReceipt[];
}

export interface CommsReceipt {
  stationKey: string;
  seat: Seat;
  /** The reader's observed vantage, on the same footing as `authorVantageId`. */
  vantageId?: string;
  /** The reader's `utNowEstimate()` when they read it. */
  atUt: number;
}

export interface CommcastSnapshot {
  messages: readonly CommsMessage[];
  /**
   * How many messages have been dropped off the front of the thread to stay
   * under the cap, cumulative for this host's lifetime.
   *
   * A thread that forgets must SAY it forgot. Silently shortening a transcript
   * leaves an operator reading a gap as though nothing was said across it,
   * which is the one thing a comms log cannot do. This is the same claim the
   * mod's own recorder makes with `Meta.GapSinceUt` when its ring drops a
   * sample, expressed on a transport that has no such field.
   */
  droppedCount: number;
}

export const EMPTY_COMMCAST_SNAPSHOT: CommcastSnapshot = {
  messages: [],
  droppedCount: 0,
};

/** What the author asks the host to append. The host stamps the rest. */
export interface CommsSendInput {
  kind: CommsMessageKind;
  body?: string;
  sentUt: number;
  oneWaySeconds: number | null;
  authorVesselId?: string;
  authorVantageId?: string;
}

/** Who a peer is, as the host knows them. */
export interface CommsParticipant {
  stationKey: string;
  name: string;
  seat: Seat;
  /** The vantage this participant reads at, when a frame has told them. */
  vantageId?: string;
}
