/**
 * The two delay-native clocks and the regime classifier — the spine of a
 * DELAYED landing. Both clocks are trivially derivable client-side from the
 * one-way delay plus the burn solve, and (as far as the design survey found)
 * are unique to gonogo. They are expressed here as MARGINS in seconds rather
 * than absolute UTs, because the burn countdown and the time-to-impact are both
 * already measured against the operator's delayed view frame, so the arithmetic
 * needs no view clock:
 *
 * - **Commit Clock** — `T_commit = T_ignition - N`. The last instant a human GO
 *   can still reach the vessel before ignition. Margin = `countdown - N`. Once
 *   <= 0 the burn either happens autonomously or not at all: COMMITTED.
 * - **Blind Clock** — `T_blind = T_impact - 2N`. The last instant you could send
 *   anything and still SEE the result before impact. Margin = `impact - 2N`.
 *   Once <= 0 the outcome is already determined and merely not yet visible: BLIND.
 *
 * The regime classifier turns the round-trip delay into the operator's role
 * (pilot / flight director / mission planner), which is what changes under
 * delay — not just the numbers.
 */

export type LandingRegime = "live" | "staged" | "autonomous" | "no-path";

/**
 * Round-trip at or below this is "effectively real-time" — LAN, no-comms, or
 * Kerbin-local. The operator can close the control loop.
 */
const LIVE_ROUND_TRIP_SEC = 1;

/**
 * Fallback staged/autonomous cut when the descent window is unknown: a
 * round-trip past this is long enough that no in-descent decision fits.
 */
const AUTONOMOUS_ROUND_TRIP_SEC = 120;

/**
 * Classify the operator's role from the one-way delay and the descent window.
 *
 * `null`/non-finite one-way => `no-path` (defensive: never silently treat a
 * lost path as live). `0` (LAN / `CommsDelaySource.None`) => `live`. Otherwise
 * a round-trip smaller than the descent means at least one decision fits inside
 * the descent (`staged`); a round-trip that swamps the descent means none does
 * (`autonomous`).
 */
export function classifyRegime(
  oneWaySeconds: number | null | undefined,
  descentSeconds: number | null | undefined,
): LandingRegime {
  if (oneWaySeconds == null || !Number.isFinite(oneWaySeconds))
    return "no-path";
  const roundTrip = 2 * Math.max(0, oneWaySeconds);
  if (roundTrip <= LIVE_ROUND_TRIP_SEC) return "live";
  if (
    descentSeconds != null &&
    Number.isFinite(descentSeconds) &&
    descentSeconds > 0
  ) {
    return roundTrip < descentSeconds ? "staged" : "autonomous";
  }
  return roundTrip < AUTONOMOUS_ROUND_TRIP_SEC ? "staged" : "autonomous";
}

export interface DelayClocks {
  regime: LandingRegime;
  /** One-way delay in seconds, or null when there is no path. */
  oneWaySeconds: number | null;
  /** Round-trip (2N) in seconds, or null when there is no path. */
  roundTripSeconds: number | null;
  /** Seconds until commit (`countdown - N`); null when no burn solution. */
  commitInSeconds: number | null;
  /** True once past the commit point — a GO can no longer reach the vessel. */
  committed: boolean;
  /** Seconds until blind (`impact - 2N`); null when no impact time. */
  blindInSeconds: number | null;
  /** True once past the blind point — the outcome is fixed and merely unseen. */
  blind: boolean;
}

export interface DelayClockInputs {
  oneWaySeconds: number | null | undefined;
  suicideBurnCountdown: number | null;
  timeToImpact: number | null;
}

export function deriveDelayClocks(inp: DelayClockInputs): DelayClocks {
  const hasPath =
    inp.oneWaySeconds != null && Number.isFinite(inp.oneWaySeconds);
  const oneWay = hasPath ? Math.max(0, inp.oneWaySeconds as number) : null;
  const roundTrip = oneWay === null ? null : 2 * oneWay;
  const regime = classifyRegime(inp.oneWaySeconds, inp.timeToImpact);

  const countdown = inp.suicideBurnCountdown;
  const commitInSeconds =
    countdown != null && Number.isFinite(countdown) && oneWay !== null
      ? countdown - oneWay
      : null;
  const committed = commitInSeconds != null && commitInSeconds <= 0;

  const impact = inp.timeToImpact;
  const blindInSeconds =
    impact != null && Number.isFinite(impact) && roundTrip !== null
      ? impact - roundTrip
      : null;
  const blind = blindInSeconds != null && blindInSeconds <= 0;

  return {
    regime,
    oneWaySeconds: oneWay,
    roundTripSeconds: roundTrip,
    commitInSeconds,
    committed,
    blindInSeconds,
    blind,
  };
}
