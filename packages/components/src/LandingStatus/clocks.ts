/**
 * The two delay-native clocks and the regime classifier, as margins in seconds: the burn countdown and time-to-impact are already measured against the operator's delayed view, so no view clock is needed.
 *
 * - Commit Clock, `T_ignition - N`: the last instant a human GO can still reach the vessel before ignition. At or below 0 the burn happens autonomously or not at all
 * - Blind Clock, `T_impact - 2N`: the last instant a command's result could still be seen before impact. Surfaced as the COMMIT POINT; at or below 0 the outcome is fixed and merely unseen
 *
 * The regime turns the round trip into the operator's role (pilot, flight director, mission planner).
 */

import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "@ksp-gonogo/ui-kit";

export type LandingRegime = "live" | "staged" | "autonomous" | "no-path";

/** A round trip at or below this is effectively real time, so the operator can close the loop. */
const LIVE_ROUND_TRIP_SEC = 1;

/** The staged/autonomous cut when the descent window is unknown. */
const AUTONOMOUS_ROUND_TRIP_SEC = 120;

/** The operator's role from one-way delay and descent window: `null` or non-finite is `no-path`, never live; `0` is `live`; a round trip shorter than the descent is `staged`, otherwise `autonomous`. */
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
  /** True once past the commit point: a GO can no longer reach the vessel. */
  committed: boolean;
  /** Seconds until blind (`impact - 2N`); null when no impact time. */
  blindInSeconds: number | null;
  /** True once past the blind point: the outcome is fixed and merely unseen. */
  blind: boolean;
  /** True once the vessel has landed; every descent countdown is then void. */
  landed: boolean;
}

export interface DelayClockInputs {
  oneWaySeconds: number | null | undefined;
  suicideBurnCountdown: number | null;
  timeToImpact: number | null;
  /** True once touched down; the clocks gate on this, since a landed vessel can still report a non-zero time-to-impact. */
  landed?: boolean;
}

export function deriveDelayClocks(inp: DelayClockInputs): DelayClocks {
  const hasPath =
    inp.oneWaySeconds != null && Number.isFinite(inp.oneWaySeconds);
  const oneWay = hasPath ? Math.max(0, inp.oneWaySeconds as number) : null;
  const roundTrip = oneWay === null ? null : 2 * oneWay;
  const regime = classifyRegime(inp.oneWaySeconds, inp.timeToImpact);

  const landed = inp.landed === true;

  const countdown = inp.suicideBurnCountdown;
  // Once landed every descent countdown is void.
  const commitInSeconds =
    !landed &&
    countdown != null &&
    Number.isFinite(countdown) &&
    oneWay !== null
      ? countdown - oneWay
      : null;
  const committed = !landed && commitInSeconds != null && commitInSeconds <= 0;

  const impact = inp.timeToImpact;
  const blindInSeconds =
    !landed && impact != null && Number.isFinite(impact) && roundTrip !== null
      ? impact - roundTrip
      : null;
  const blind = !landed && blindInSeconds != null && blindInSeconds <= 0;

  return {
    regime,
    oneWaySeconds: oneWay,
    roundTripSeconds: roundTrip,
    commitInSeconds,
    committed,
    blindInSeconds,
    blind,
    landed,
  };
}

/**
 * The one-way delay off `comms.delay`, or `null` when nothing has established one.
 *
 * `null` means NO PATH and zero means a measured zero-distance link, so this never coerces: a coerced zero reads as `live` and shows a burn countdown for a craft nothing can reach. The VALUE decides, never `source`, since `CommsDelaySource.None` carries both a LAN zero and the no-path null. A negative delay is impossible and reads as unknown.
 */
export function readOneWaySeconds(
  delay:
    | { source?: number; oneWaySeconds?: Value<"s"> | number | null }
    | undefined,
): number | null {
  if (!delay) return null;
  const s = magnitudeOf(delay.oneWaySeconds);
  if (s === null || s < 0) return null;
  return s;
}
