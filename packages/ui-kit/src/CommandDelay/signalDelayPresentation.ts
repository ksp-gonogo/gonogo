/**
 * Which ONE of the two delay readings a console shows, given how far away the
 * other end is.
 *
 * A console that composes something and sends it has two ways to say what the
 * delay costs, and they answer different questions:
 *
 *   - a BADGE is a standing readout of the separation itself, useful before
 *     anything has been sent and worthless as a countdown
 *   - a STRIP (`InFlightList`) is one row per thing actually crossing, with the
 *     instant it lands, useful only once something is out
 *
 * They are MUTUALLY EXCLUSIVE, which is the whole reason this is a function
 * and not two booleans at the call site. Drawn together they say the same
 * number twice in two different shapes, and the operator has to work out which
 * one is about the message they just sent. Under a second the countdown is
 * over before it can be read, so the badge is the only useful form; past that
 * the strip carries the figure and a badge beside it is a duplicate.
 *
 * The one-second boundary is `currentMode`'s own `STAGED_THRESHOLD_SECONDS`,
 * not a display taste: past it the engine itself stages a dispatch rather than
 * treating it as live, and `signalDelayPresentation.test.ts` pins the two
 * together so neither can drift alone.
 */
export type SignalDelayPresentation = "badge" | "strip" | "none";

/**
 * Matches `currentMode`'s live/staged boundary in `@ksp-gonogo/sitrep-sdk`. A
 * local literal rather than an import because this module takes a plain number
 * (see `oneWaySeconds` below) and the sdk's own constant is not exported; the
 * test asserts they agree.
 */
export const SIGNAL_DELAY_STRIP_THRESHOLD_SECONDS = 1;

export interface SignalDelayPresentationInput {
  /**
   * One-way separation in seconds, `null` when there is no measurable path.
   *
   * A plain number, not a `Value<"s">`, for the same reason `InFlightList` takes
   * plain numbers: this package stays props-driven and free of the contract's
   * own types. Callers unwrap their own read, and one of them has already been
   * caught by that: the terminal's local declaration claimed a bare number
   * where the wrapped payload hands back a `Value`, and it went unnoticed
   * because the only use was `2 * x`, which coerces through `valueOf`. A
   * comparison would have been silently comparing an object.
   *
   * `null` and `0` are different readings and neither gets a badge: `null` is
   * no path at all, `0` is a link with no measurable delay, and a chip saying
   * "one-way ~0 s" is noise on a dashboard sitting at the pad.
   */
  oneWaySeconds: number | null;
  /**
   * Whether this console can put something in the strip. A read-only viewer
   * dispatches nothing, so at a long delay it gets NEITHER reading: there is no
   * queue to draw and a standing badge would be quoting a cost it never pays.
   */
  canQueue: boolean;
  /**
   * Force the badge whatever the magnitude. The kOS terminal in CHARACTER mode
   * sets this: every keystroke goes to the wire on its own and the round trip
   * shows as the terminal's own latency, so there is no composed line to queue
   * and the strip has nothing to list at any delay.
   */
  alwaysBadge?: boolean;
}

export function signalDelayPresentation({
  oneWaySeconds,
  canQueue,
  alwaysBadge = false,
}: SignalDelayPresentationInput): SignalDelayPresentation {
  if (oneWaySeconds === null || oneWaySeconds <= 0) return "none";
  if (alwaysBadge) return "badge";
  if (oneWaySeconds <= SIGNAL_DELAY_STRIP_THRESHOLD_SECONDS) return "badge";
  return canQueue ? "strip" : "none";
}
