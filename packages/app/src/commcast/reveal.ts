import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";
import type { CommsMessage, CommsReceipt } from "./types";

/**
 * Where a participant is reading from, which is what their delay to everyone
 * else is computed against.
 *
 * `seat` is the coarse axis and is always known. `vantageId` is the fine one:
 * `useObservedVantage()`, the centre the frames in front of this operator were
 * actually delayed from. It is `undefined` before the first frame lands, and a
 * station reports its HOST's vantage, which is right: a station reads the
 * host's relayed frames verbatim, so the two are genuinely co-located.
 */
export interface Vantage {
  seat: Seat;
  vantageId?: string;
}

/**
 * How far apart two participants are, and how well that is known.
 *
 * The seat axis alone answers this for pilot-versus-ground and gets two
 * command centres at DIFFERENT vantages wrong, because they share the seat
 * `mission-control` and would read each other instantly however far apart they
 * are. The vantage id is what separates those two cases, so the rule keys on
 * it and the seat rule falls out as the case where both ends share a vantage.
 */
export type Separation =
  /** Same vantage: no distance, whatever the craft's distance from home. */
  | { kind: "co-located"; seconds: 0 }
  /** Across the craft's own path home, the quantity `comms.delay` measures. */
  | { kind: "light-time"; seconds: number }
  /** No measurable path when it was spoken, so it cannot cross seats at all. */
  | { kind: "no-path" }
  /**
   * Two command centres at different vantages. The mod already computes this
   * number, `DelayTo(fromCentre, "centre." + toCentre)` for every ordered pair
   * of active centres, and no channel publishes it, so the client cannot read
   * it. The message is delivered rather than lost, and the UI SAYS the
   * separation is unpublished instead of implying a measured zero.
   */
  | { kind: "unmeasured" };

/**
 * A published separation between two vantages: `separation.get(from)?.get(to)`
 * in one-way seconds. Sparse by construction, because an unroutable pair has no
 * number rather than a zero.
 */
export type SeparationMatrix = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * The separation `msg`'s author had from a reader at `me` when it was spoken.
 *
 * Commcast is a BROADCAST: one message reaches every vantage, and no sender can
 * know its separation to every receiver, present or future. So the envelope
 * carries WHERE and WHEN it was spoken and each receiver resolves its own
 * distance from that, in this order:
 *
 *   1. the same vantage is no distance, whatever else is true. This covers a
 *      host and its stations (a station relays the host's frames, so it reads at
 *      the host's vantage) and two operators at one centre
 *   2. the published pair matrix, which is the general answer and the only one
 *      that scales to several centres and several craft
 *   3. the sender's own path home, for a craft-to-ground pair. This is the ONE
 *      pair `comms.delay` answers and it is the headline case, so it stands in
 *      until the matrix reaches this pair
 *   4. otherwise `unmeasured`, said out loud rather than guessed
 */
export function separationFor(
  msg: CommsMessage,
  me: Vantage,
  pairs?: SeparationMatrix,
): Separation {
  const from = msg.authorVantageId;
  const to = me.vantageId;

  if (from !== undefined && to !== undefined && from === to) {
    return { kind: "co-located", seconds: 0 };
  }

  if (from !== undefined && to !== undefined) {
    const published = pairs?.get(from)?.get(to);
    if (published !== undefined) {
      return { kind: "light-time", seconds: published };
    }
  }

  if (msg.authorSeat !== me.seat) {
    // A craft and the ground. `comms.delay` measures exactly this path, and
    // both ends read the same number off it, so the sender's frozen figure is
    // the right one until the matrix covers the pair.
    if (msg.oneWaySeconds === null) return { kind: "no-path" };
    return { kind: "light-time", seconds: msg.oneWaySeconds };
  }

  // Same seat, and no published pair. Two pilots are only co-located if they
  // are on the same craft, which is a thing their vantage ids say and their
  // seat does not: assuming one active vessel would be exactly the assumption
  // a second craft breaks.
  if (from === undefined || to === undefined) {
    // Nobody has claimed a differing vantage, so the one-vantage reading is
    // what the evidence supports. Before the first frame lands nobody has an
    // id at all, and inventing a separation out of that absence would put
    // every fresh page load behind an imaginary delay.
    return { kind: "co-located", seconds: 0 };
  }
  return { kind: "unmeasured" };
}

/** Seconds a message spends crossing to `me`, or `null` when it never arrives. */
export function transitSecondsFor(
  msg: CommsMessage,
  me: Vantage,
  pairs?: SeparationMatrix,
): number | null {
  const sep = separationFor(msg, me, pairs);
  switch (sep.kind) {
    case "co-located":
      return 0;
    case "light-time":
      return sep.seconds;
    case "unmeasured":
      return 0;
    case "no-path":
      return null;
  }
}

/**
 * The UT at which `msg` becomes visible at `me`, or `null` when it can never
 * get there.
 *
 * A message never crosses light-time to reach its own vantage, so an author
 * (and anyone reading at the same vantage) sees it the instant it is spoken,
 * whatever the craft's separation from the ground happens to be.
 */
export function revealUtFor(
  msg: CommsMessage,
  me: Vantage,
  pairs?: SeparationMatrix,
): number | null {
  const transit = transitSecondsFor(msg, me, pairs);
  return transit === null ? null : msg.sentUt + transit;
}

/** How a message stands at one seat right now. */
export type Delivery =
  | {
      state: "revealed";
      revealUt: number;
      transitSeconds: number;
      separation: Separation["kind"];
    }
  | {
      state: "in-transit";
      revealUt: number;
      transitSeconds: number;
      separation: Separation["kind"];
    }
  /**
   * The author had no path home when they spoke, so it is never delivered.
   * Not a long delay: the author is told, and can retry, rather than watching
   * it hang forever. The mod's own blackout precedent drops the backlog on
   * reconnect, which is right for telemetry and wrong for a person's words.
   */
  | { state: "no-path" };

/**
 * How `msg` stands at `me` as of `utNow`.
 *
 * `utNow` is the reader's OWN present (`ViewClock.utNowEstimate()`), never
 * their `confirmedEdgeUt()`. The two differ by the delay, and gating on the
 * delayed one would hold a message until `sentUt + 2 x oneWaySeconds`: a round
 * trip for a one-way utterance. A telemetry sample and a video frame carry a
 * CAPTURE UT from the craft's past and are rightly released against the
 * confirmed edge; a human message carries a SEND UT minted at the sender's
 * present and is not.
 */
export function deliveryFor(
  msg: CommsMessage,
  me: Vantage,
  utNow: number,
  pairs?: SeparationMatrix,
): Delivery {
  const sep = separationFor(msg, me, pairs);
  if (sep.kind === "no-path") return { state: "no-path" };
  const transitSeconds = sep.kind === "light-time" ? sep.seconds : 0;
  const revealUt = msg.sentUt + transitSeconds;
  return utNow >= revealUt
    ? { state: "revealed", revealUt, transitSeconds, separation: sep.kind }
    : { state: "in-transit", revealUt, transitSeconds, separation: sep.kind };
}

/**
 * A read receipt is itself a thing one human tells another, so it crosses the
 * same separation on the same rule: learning that the crew read your message
 * four minutes ago is the honest report, and showing it the instant they tap
 * would be a faster-than-light channel hiding inside the UI.
 */
export function receiptRevealUt(
  receipt: CommsReceipt,
  msg: CommsMessage,
  me: Vantage,
  pairs?: SeparationMatrix,
): number | null {
  const transit = transitSecondsFor(
    { ...msg, authorSeat: receipt.seat, authorVantageId: receipt.vantageId },
    me,
    pairs,
  );
  return transit === null ? null : receipt.atUt + transit;
}

/** The receipts on `msg` that have reached `me` by `utNow`. */
export function revealedReceipts(
  msg: CommsMessage,
  me: Vantage,
  utNow: number,
  pairs?: SeparationMatrix,
): readonly CommsReceipt[] {
  return msg.readBy.filter((r) => {
    const at = receiptRevealUt(r, msg, me, pairs);
    return at !== null && utNow >= at;
  });
}

/**
 * The order a seat's thread renders in: by the instant each message landed
 * HERE, with the host's arrival stamp breaking a tie.
 *
 * Ordering by `sentUt` is the intuitive choice and it retroactively inserts: a
 * message spoken a light-time ago arrives now and would slot in ABOVE things
 * the operator has already read. Arrival order never rewrites what someone has
 * read and stays causally sound per seat, because a reply is only ever sent
 * after its author saw what it answers. The cost is that two participants'
 * threads differ in order and neither is the canonical transcript: that is the
 * feature, and the UI says so rather than hiding it.
 */
export function byArrivalAt(
  me: Vantage,
  pairs?: SeparationMatrix,
): (a: CommsMessage, b: CommsMessage) => number {
  return (a, b) => {
    const ra = revealUtFor(a, me, pairs);
    const rb = revealUtFor(b, me, pairs);
    if (ra === null || rb === null) {
      // A no-path message never arrives anywhere; keep it after everything
      // that did, so the author still sees it in their own outgoing order.
      if (ra !== rb) return ra === null ? 1 : -1;
      return a.receivedAtMs - b.receivedAtMs;
    }
    if (ra !== rb) return ra - rb;
    return a.receivedAtMs - b.receivedAtMs;
  };
}
