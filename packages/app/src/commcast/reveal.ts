/**
 * How a Commcast message stands at the screen that said it, and when things
 * reached this one.
 *
 * The crossing itself is the mod's: everything said goes up as a command and
 * comes down addressed, one light-time from where it was said, so nothing here
 * holds anything back. What is left is the author's own arithmetic, from the
 * published separation matrix: how long their words take to reach the group,
 * when an answer could soonest be back, and when an unanswered message stops
 * waiting.
 */
import { LOSS_MARGIN } from "@ksp-gonogo/sitrep-client";
import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";
import type {
  CommsAck,
  CommsMessage,
  Delivery,
  OutboundMessage,
  RecipientId,
} from "./types";

/**
 * Where a participant is reading from, which is what their separation to
 * everyone else is computed against.
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
 * How far apart two vantages are, and how well that is known.
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
  /** A measured path between the two, in one-way seconds. */
  | { kind: "light-time"; seconds: number }
  /** No path when it was spoken, so nothing crosses at all. */
  | { kind: "no-path" }
  /**
   * A pair the published matrix has not reached and no fallback covers. The
   * message is still SENT rather than refused, and the UI says the separation
   * is unpublished instead of implying a measured zero.
   */
  | { kind: "unmeasured" };

/**
 * A published separation between two vantages: `pairs.get(from)?.get(to)` in
 * one-way seconds. Sparse by construction, because an unroutable pair has no
 * number rather than a zero.
 */
export type SeparationMatrix = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * The separation between two vantages, in this order:
 *
 *   1. one vantage is no distance from itself, whatever else is true. This
 *      covers a host and its stations (a station relays the host's frames, so
 *      it reads at the host's vantage) and two operators at one centre
 *   2. the published pair matrix, which is the SERVER's number: the geometry is
 *      solved once, where it is known
 *   3. `fallbackSeconds`, the caller's own best figure for this pair. At send
 *      that is `comms.delay`, the craft-to-ground path, which is the headline
 *      case and the one pair that channel answers; at the far end it is the
 *      number the author froze into the envelope
 *   4. otherwise `unmeasured`, said out loud rather than guessed
 */
export function separationBetween(
  from: RecipientId | undefined,
  to: RecipientId | undefined,
  fallbackSeconds: number | null | undefined,
  pairs?: SeparationMatrix,
): Separation {
  if (from !== undefined && to !== undefined && from === to) {
    return { kind: "co-located", seconds: 0 };
  }
  if (from !== undefined && to !== undefined) {
    const published = pairs?.get(from)?.get(to);
    if (published !== undefined) {
      return { kind: "light-time", seconds: published };
    }
  }
  if (fallbackSeconds === null) return { kind: "no-path" };
  if (fallbackSeconds !== undefined && Number.isFinite(fallbackSeconds)) {
    return { kind: "light-time", seconds: fallbackSeconds };
  }
  // Neither end has claimed a differing vantage and nothing measured the pair.
  // Before the first frame lands nobody has a vantage id at all, and inventing
  // a separation out of that absence would put every fresh page load behind an
  // imaginary delay.
  if (from === undefined || to === undefined) {
    return { kind: "co-located", seconds: 0 };
  }
  return { kind: "unmeasured" };
}

/**
 * Seconds a crossing over `sep` takes, or `null` when there is no crossing.
 *
 * The one place the four separation kinds collapse to a number, so a caller
 * cannot quietly read `unmeasured` as a measured zero in one place and as a
 * refusal in another. `null` is NO PATH and only that, which is what makes a
 * cut a value rather than a special case.
 */
export function transitSecondsOf(sep: Separation): number | null {
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
 * The two legs a sent message travels, in the vocabulary
 * `FleetComms/pendingPulse.ts` already uses for a delayed command's pulse:
 * `outbound` is author to recipient (the first `oneWaySeconds`), `return` is
 * the acknowledgement coming back (the second).
 *
 * Measured from `lastSentUt`, so a resend genuinely restarts the journey.
 */
export interface RoundTrip {
  /** When the words reach the recipient. `dispatchedAt + oneWaySeconds`. */
  reachUt: number;
  /** When an acknowledgement could soonest be back. `+ 2 * oneWaySeconds`. */
  replyUt: number;
  /**
   * When an unanswered message stops waiting, `replyUt` plus the same
   * `LOSS_MARGIN` the shipped command path allows. Deliberately the same
   * three seconds rather than a margin invented here: the two are the same
   * question about the same geometry.
   */
  overdueUt: number;
}

/**
 * The round trip of one recipient's delivery, or of a message's longest
 * separation, or `null` when it never left.
 */
export function roundTripFor(
  sent: Pick<Delivery, "lastSentUt" | "separationSeconds">,
): RoundTrip | null {
  const s = sent.separationSeconds;
  if (s === null || !Number.isFinite(s) || s < 0) return null;
  return {
    reachUt: sent.lastSentUt + s,
    replyUt: sent.lastSentUt + 2 * s,
    overdueUt: sent.lastSentUt + 2 * s + LOSS_MARGIN,
  };
}

/**
 * One-way seconds from `me` to each member other than itself, `null` for a
 * member with no path. Each is frozen into its own delivery at send.
 */
export function separationsTo(
  me: RecipientId | undefined,
  members: readonly RecipientId[],
  fallbackSeconds: number | null | undefined,
  pairs?: SeparationMatrix,
): ReadonlyMap<RecipientId, number | null> {
  const out = new Map<RecipientId, number | null>();
  for (const member of members) {
    if (member === me) continue;
    out.set(
      member,
      transitSecondsOf(separationBetween(me, member, fallbackSeconds, pairs)),
    );
  }
  return out;
}

/**
 * How far `me` is from a group, read as the member farthest away that there is
 * a path to.
 *
 * The farthest because that is the separation a message to the group spends
 * crossing before everyone has it. `no-path` only when there is a path to no
 * member at all: a member out of reach misses what is said, which its own end
 * resolves, and the rest still hear it. The author's own vantage is not a
 * member it has to reach.
 */
export function groupSeparation(
  me: RecipientId | undefined,
  members: readonly RecipientId[],
  fallbackSeconds: number | null | undefined,
  pairs?: SeparationMatrix,
): Separation {
  let farthest: Separation | undefined;
  for (const member of members) {
    if (me !== undefined && member === me) continue;
    const sep = separationBetween(me, member, fallbackSeconds, pairs);
    if (sep.kind === "no-path") continue;
    if (farthest === undefined || secondsOf(sep) > secondsOf(farthest)) {
      farthest = sep;
    }
  }
  if (farthest !== undefined) return farthest;
  return members.some((m) => m !== me)
    ? { kind: "no-path" }
    : { kind: "co-located", seconds: 0 };
}

function secondsOf(sep: Separation): number {
  return transitSecondsOf(sep) ?? 0;
}

/**
 * The instant `msg` became visible here: when it arrived, or, for this screen's
 * own words, when they were said.
 */
export function heardUtOf(msg: CommsMessage): number {
  return msg.arrivedUt ?? msg.lastSentUt;
}

/** The acknowledgements on `out` that have reached this screen by `utNow`. */
export function revealedAcks(
  out: OutboundMessage,
  utNow: number,
): readonly CommsAck[] {
  return out.acks.filter((ack) => ack.arrivedUt <= utNow);
}

/**
 * The instant the first acknowledgement of `out` reached its author, or
 * `undefined` while none has.
 */
export function firstAckUtFor(out: OutboundMessage): number | undefined {
  let soonest: number | undefined;
  for (const ack of out.acks) {
    if (soonest === undefined || ack.arrivedUt < soonest)
      soonest = ack.arrivedUt;
  }
  return soonest;
}

/** The instant `delivery`'s recipient's acknowledgement reached the author, or `undefined` while none has. */
export function deliveryAckUtFor(
  out: OutboundMessage,
  delivery: Delivery,
): number | undefined {
  let soonest: number | undefined;
  for (const ack of out.acks) {
    if (ack.from !== delivery.to) continue;
    if (soonest === undefined || ack.arrivedUt < soonest)
      soonest = ack.arrivedUt;
  }
  return soonest;
}

/**
 * How a sent message stands at its author, in the phase vocabulary
 * `classifyRetained` already uses for a delayed command. The two are the same
 * question about the same geometry, so this reuses the names rather than
 * minting a parallel set.
 *
 *   - `in-transit`   travelling out, on the `outbound` leg
 *   - `awaiting-reply` arrived, the acknowledgement is on the `return` leg
 *   - `due`          the reply instant has come and nothing is back yet
 *   - `overdue`      past `replyUt + LOSS_MARGIN` with no acknowledgement
 *   - `lost`         the path was not up across the window, so nothing crossed
 *   - `confirmed`    an acknowledgement has arrived HERE
 *
 * `confirmed` is the one name that is not `classifyRetained`'s, because that
 * function has no such arm: a command's queue entry simply disappears. A
 * message does not disappear, it is a thing somebody said, so the arrival has
 * to be a state it can be IN.
 */
export type SentPhase =
  | "in-transit"
  | "awaiting-reply"
  | "due"
  | "overdue"
  | "lost"
  | "confirmed";

/** Which of the two pulse legs a phase is on, or `null` once it is settled. */
export function legOf(phase: SentPhase): "outbound" | "return" | null {
  if (phase === "in-transit") return "outbound";
  if (phase === "awaiting-reply" || phase === "due") return "return";
  return null;
}

/**
 * One recipient's standing at the author as of `utNow`.
 *
 * The gate on `confirmed` is that recipient's own acknowledgement having
 * REACHED here, never one merely recorded and never anybody else's, which is
 * why the group's first answer cannot speak for the rest.
 */
export function deliveryPhaseFor(
  out: OutboundMessage,
  delivery: Delivery,
  utNow: number,
): SentPhase {
  const ackUt = deliveryAckUtFor(out, delivery);
  if (ackUt !== undefined && utNow >= ackUt) return "confirmed";
  // Nothing left, so nothing is travelling and nothing will answer. Not a long
  // wait: the operator is told, and can resend, rather than watching a
  // countdown for a journey that never started.
  if (delivery.neverLeft) return "lost";
  const trip = roundTripFor(delivery);
  if (trip === null) return "lost";
  if (utNow < trip.reachUt) return "in-transit";
  if (utNow < trip.replyUt) return "awaiting-reply";
  if (utNow < trip.overdueUt) return "due";
  return "overdue";
}

/** How a whole send reads at its author: one verdict across every recipient. */
export type MessageStatus = "received" | "in-transit" | "unconfirmed";

/**
 * `received` when every recipient has answered, `in-transit` while any
 * recipient's wait is still running, `unconfirmed` once every wait is over and
 * somebody has not answered.
 */
export function messageStatusFor(
  out: OutboundMessage,
  utNow: number,
): MessageStatus {
  let unanswered = false;
  for (const delivery of out.deliveries) {
    const phase = deliveryPhaseFor(out, delivery, utNow);
    if (phase === "confirmed") continue;
    if (!isSettled(phase)) return "in-transit";
    unanswered = true;
  }
  return unanswered ? "unconfirmed" : "received";
}

/**
 * Whether a sent message has settled: it is no longer travelling, so it
 * belongs in the log rather than in the uplink queue.
 *
 * The terminal widget's rule, and the reason the queue never grows without bound:
 * a line leaves the strip when its journey ends, either because it echoed or
 * because the wait ran out. `overdue` and `lost` therefore never render as a
 * queue row; they render as an UNCONFIRMED message in the log, which is a
 * state rather than a failure, with one resend attached.
 */
export function isSettled(phase: SentPhase): boolean {
  return phase === "confirmed" || phase === "overdue" || phase === "lost";
}

/**
 * The instant a sent message enters its own author's log, or `undefined` while
 * it is still travelling. For a group that is the first answer from anyone, or
 * the end of the last recipient's wait.
 *
 * This is the line that makes Commcast read like the terminal widget in line
 * mode: there, a composed line is echoed into the buffer only after the full
 * round trip, so the delay is felt as absence then arrival rather than
 * described by a number. Here an author's own words are held the same way and
 * land when one of two things happens, both of which are evidence:
 *
 *   - an acknowledgement reaches them. The words are on screen because
 *     somebody heard them, not because the author typed them
 *   - the wait runs out at `overdueUt`, and they land UNCONFIRMED. An author
 *     never loses what they said, and unconfirmed is a state the message is
 *     in, not an error about it
 *
 * A message that never left lands at once, because there is nothing to wait
 * for and the author is standing next to it.
 */
export function sentArrivalUtFor(
  out: OutboundMessage,
  utNow: number,
): number | undefined {
  let giveUpUt: number | undefined;
  for (const delivery of out.deliveries) {
    if (delivery.neverLeft) continue;
    const trip = roundTripFor(delivery);
    if (trip === null) continue;
    if (giveUpUt === undefined || trip.overdueUt > giveUpUt)
      giveUpUt = trip.overdueUt;
  }
  if (giveUpUt === undefined) return out.msg.lastSentUt;
  const firstAck = firstAckUtFor(out);
  if (firstAck !== undefined && firstAck <= giveUpUt) return firstAck;
  return utNow >= giveUpUt ? giveUpUt : undefined;
}
