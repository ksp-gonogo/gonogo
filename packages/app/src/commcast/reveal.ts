import { LOSS_MARGIN } from "@ksp-gonogo/sitrep-client";
import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";
import type {
  CommsAck,
  CommsMessage,
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
 * The separation `msg` crossed to reach a reader at `me`.
 *
 * The reader resolves it themselves rather than trusting the envelope, because
 * the published matrix is better evidence than a number the author froze
 * minutes ago. The frozen figure is the fallback, which is what makes the pair
 * resolvable at all before the matrix covers it.
 */
export function separationFor(
  msg: CommsMessage,
  me: Vantage,
  pairs?: SeparationMatrix,
): Separation {
  return separationBetween(
    msg.from,
    me.vantageId,
    msg.separationSeconds,
    pairs,
  );
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
 * One crossing, not a round trip. `utNow` at the reader is their OWN present
 * (`ViewClock.utNowEstimate()`), never their `confirmedEdgeUt()`: the two
 * differ by the delay, and gating on the delayed one would hold a message
 * until `sentUt + 2S`. A telemetry sample and a video frame carry a CAPTURE UT
 * from the craft's past and are rightly released against the confirmed edge; a
 * human message carries a SEND UT minted at the sender's present and is not.
 */
export function revealUtFor(
  msg: CommsMessage,
  me: Vantage,
  pairs?: SeparationMatrix,
): number | null {
  const transit = transitSecondsFor(msg, me, pairs);
  return transit === null ? null : msg.lastSentUt + transit;
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

/** `msg`'s round trip to its recipient, or `null` when it never left. */
export function roundTripFor(msg: CommsMessage): RoundTrip | null {
  const s = msg.separationSeconds;
  if (s === null || !Number.isFinite(s) || s < 0) return null;
  return {
    reachUt: msg.lastSentUt + s,
    replyUt: msg.lastSentUt + 2 * s,
    overdueUt: msg.lastSentUt + 2 * s + LOSS_MARGIN,
  };
}

/**
 * The UT at which an acknowledgement reaches the author at `me`, or `null`
 * when it can never get there.
 *
 * The return leg, delayed on exactly the rule the outbound one was: learning
 * that the crew read your message four minutes ago is the honest report, and
 * showing it the instant they tap would be the faster-than-light channel this
 * design exists to avoid.
 */
export function ackRevealUt(
  ack: CommsAck,
  msg: CommsMessage,
  me: Vantage,
  pairs?: SeparationMatrix,
): number | null {
  const sep = separationBetween(
    ack.from,
    me.vantageId,
    msg.separationSeconds,
    pairs,
  );
  switch (sep.kind) {
    case "co-located":
      return ack.atUt;
    case "light-time":
      return ack.atUt + sep.seconds;
    case "unmeasured":
      return ack.atUt;
    case "no-path":
      return null;
  }
}

/** The acknowledgements on `out` that have reached `me` by `utNow`. */
export function revealedAcks(
  out: OutboundMessage,
  me: Vantage,
  utNow: number,
  pairs?: SeparationMatrix,
): readonly CommsAck[] {
  return out.acks.filter((ack) => {
    const at = ackRevealUt(ack, out.msg, me, pairs);
    return at !== null && utNow >= at;
  });
}

/**
 * The instant the first acknowledgement of `out` reaches its author at `me`,
 * or `undefined` while nobody has made one.
 */
export function firstAckUtFor(
  out: OutboundMessage,
  me: Vantage,
  pairs?: SeparationMatrix,
): number | undefined {
  let soonest: number | undefined;
  for (const ack of out.acks) {
    const at = ackRevealUt(ack, out.msg, me, pairs);
    if (at === null) continue;
    if (soonest === undefined || at < soonest) soonest = at;
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
 * `msg`'s standing at its author as of `utNow`.
 *
 * The gate on `confirmed` is an acknowledgement that has REACHED here, never
 * one merely recorded: `revealedAcks` is what enforces that, and it is why
 * `firstAckUtFor` is compared against `utNow` rather than simply tested for
 * existence.
 */
export function sentPhaseFor(
  out: OutboundMessage,
  me: Vantage,
  utNow: number,
  pairs?: SeparationMatrix,
): SentPhase {
  const firstAck = firstAckUtFor(out, me, pairs);
  if (firstAck !== undefined && utNow >= firstAck) return "confirmed";
  // Nothing left, so nothing is travelling and nothing will answer. Not a long
  // wait: the operator is told, and can resend, rather than watching a
  // countdown for a journey that never started.
  if (out.neverLeft) return "lost";
  const trip = roundTripFor(out.msg);
  if (trip === null) return "lost";
  if (utNow < trip.reachUt) return "in-transit";
  if (utNow < trip.replyUt) return "awaiting-reply";
  if (utNow < trip.overdueUt) return "due";
  return "overdue";
}

/**
 * Whether a sent message has settled: it is no longer travelling, so it
 * belongs in the log rather than in the uplink queue.
 *
 * The kOS terminal's rule, and the reason the queue never grows without bound:
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
 * it is still travelling.
 *
 * This is the line that makes Commcast read like the kOS terminal in line
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
  me: Vantage,
  utNow: number,
  pairs?: SeparationMatrix,
): number | undefined {
  if (out.neverLeft) return out.msg.lastSentUt;
  const trip = roundTripFor(out.msg);
  if (trip === null) return out.msg.lastSentUt;
  const firstAck = firstAckUtFor(out, me, pairs);
  if (firstAck !== undefined && firstAck <= trip.overdueUt) return firstAck;
  return utNow >= trip.overdueUt ? trip.overdueUt : undefined;
}
