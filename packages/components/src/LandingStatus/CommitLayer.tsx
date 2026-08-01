/**
 * CommitLayer: the delay-native "soul" of the landing widget, and what makes it
 * gonogo's rather than a re-skinned KER. Under signal delay a landing cannot be
 * hand-flown, so the job shifts from "cue the burn" to "did I commit correctly
 * before I went blind":
 *
 * - Regime pill (LIVE / STAGED / AUTONOMOUS / LINK, ) + round-trip.
 * - Hero: live → the ignition countdown; delayed → the burn-GO clock (the last
 *   instant a GO can still reach the vessel to START the burn, T_ignition − N) →
 *   BURN LOCKED once past it.
 * - UNCOMMANDABLE banner: when the round-trip exceeds the remaining burn window,
 *   a command sent now cannot be confirmed in time. Arguably the single most
 *   valuable thing this widget can say.
 * - COMMIT POINT line: the last instant a command's RESULT can still be seen
 *   before impact (T_impact − 2N); past it the outcome is fixed and merely not
 *   yet visible. (The spaceflight-standard term for what was internally "blind".)
 *
 * Landing is an INSTRUMENT, not a command surface, gear/brakes are fired from
 * the operator's own action-group widgets placed alongside, so this layer holds
 * only decision-support (clocks, uncommandable, ignition cue), no commands.
 *
 * Presentational: the clocks are derived upstream by `deriveDelayClocks`.
 */

import {
  formatDuration,
  NULL_DISPLAY,
  Readout,
  ReadoutCaption,
  type ReadoutTone,
  Section,
} from "@ksp-gonogo/ui-kit";
import type { LandingRegime } from "./clocks";

export const REGIME_LABEL: Record<LandingRegime, string> = {
  live: "LIVE",
  staged: "STAGED",
  autonomous: "AUTONOMOUS",
  "no-path": "NO LINK",
};

export const REGIME_TONE: Record<LandingRegime, ReadoutTone> = {
  live: "go",
  staged: "warning",
  autonomous: "alert",
  "no-path": "default",
};

export interface CommitLayerProps {
  regime: LandingRegime;
  roundTripSeconds: number | null;
  /** True when the loop is effectively real-time (live or no-path). */
  live: boolean;
  suicideBurnCountdown: number | null;
  commitInSeconds: number | null;
  committed: boolean;
  blindInSeconds: number | null;
  blind: boolean;
  /** True once the vessel has touched down, the descent clocks are then void
   * and the hero shows a settled LANDED state instead of a stale countdown. */
  landed?: boolean;
}

export function CommitLayer({
  regime,
  roundTripSeconds,
  live,
  suicideBurnCountdown,
  commitInSeconds,
  committed,
  blindInSeconds,
  blind,
  landed = false,
}: Readonly<CommitLayerProps>) {
  const countdown = suicideBurnCountdown;

  // Uncommandable: a full round-trip no longer fits inside the remaining burn
  // window, so a command sent now cannot be confirmed (or corrected) in time.
  // Void once landed: there is no burn window left.
  const _uncommandable =
    !landed &&
    roundTripSeconds != null &&
    roundTripSeconds > 0 &&
    countdown != null &&
    countdown > 0 &&
    roundTripSeconds > countdown;

  let heroValue: string;
  let heroCaption: string;
  let heroTone: ReadoutTone;
  let urgent = false;
  if (landed) {
    // Settled on the surface: the descent is over, so no commit / blind / burn
    // countdown: a confident touchdown confirmation instead.
    heroValue = "LANDED";
    heroCaption = "TOUCHDOWN CONFIRMED";
    heroTone = "go";
  } else if (live) {
    heroCaption = "SUICIDE BURN";
    if (countdown == null) {
      heroValue = NULL_DISPLAY;
      heroTone = "default";
    } else if (countdown <= 0) {
      heroValue = "IGNITE";
      heroTone = "alert";
      urgent = true;
    } else {
      heroValue = `T−${formatDuration(countdown, { ms: true })}`;
      urgent = countdown <= 5;
      heroTone = urgent ? "alert" : "warning";
    }
  } else {
    // The burn-GO deadline: the last instant a human GO can still reach the
    // vessel in time to START the suicide burn (T_ignition − N). Named apart
    // from the COMMIT POINT (the impact-command deadline below) to avoid a
    // "COMMITTED vs commit point" clash.
    heroCaption = "BURN GO IN";
    if (committed) {
      heroValue = "BURN LOCKED";
      heroTone = "alert";
      // Past the deadline a GO can no longer arrive in time, the burn plan is
      // locked in (autonomous), so the "BURN GO IN" caption is dropped.
      heroCaption = "";
    } else if (commitInSeconds == null) {
      heroValue = NULL_DISPLAY;
      heroTone = "default";
    } else {
      heroValue = `T−${formatDuration(commitInSeconds, { ms: true })}`;
      heroTone = "warning";
    }
  }

  // Only the instantaneous ignition cue interrupts (assertive). Uncommandable /
  // blind are sustained states, announce them politely, per the a11y rule that
  // reserves assertive for ABORT-class events.
  const alarmed = urgent;

  return (
    <Section
      role={alarmed ? "alert" : "status"}
      aria-live={alarmed ? "assertive" : "polite"}
    >
      <Readout $tone={heroTone}>
        {heroValue}
        {heroCaption && <ReadoutCaption>{heroCaption}</ReadoutCaption>}
      </Readout>

      {/* UNCOMMANDABLE and PAST COMMIT POINT both used to sit here, and both
            said the same thing twice: the round trip is longer than the window
            left, so nothing you send now lands in time. The round trip is the
            instrument datum, and it is in the panel header beside the regime,
            so the operator can read the arithmetic rather than be told its
            conclusion twice in two vocabularies. */}
    </Section>
  );
}
