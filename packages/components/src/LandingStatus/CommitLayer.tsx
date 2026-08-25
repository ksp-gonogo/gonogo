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

import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  NULL_DISPLAY,
  Readout,
  ReadoutCaption,
  type ReadoutTone,
  Section,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
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
  /**
   * True when the loop is real-time. A `no-path` regime is NOT live: an unknown
   * link takes its own hero arm below rather than borrowing this one.
   */
  live: boolean;
  /**
   * Whether an INSTRUCTION may be named at all: every input the burn solve rests on
   * is current.
   *
   * The hero is the one part of this widget an operator acts on at a named moment,
   * so it is the one part that must not render from a modelled or last-known state.
   * The board around it describes from the best value available and says so; this
   * refuses instead, because a suicide-burn instant computed from a propagated
   * position is not a dated number, it is a wrong one.
   */
  mayInstruct: boolean;
  suicideBurnCountdown: number | null;
  commitInSeconds: number | null;
  committed: boolean;
  blindInSeconds: number | null;
  blind: boolean;
  /** True once the vessel has touched down, the descent clocks are then void
   * and the hero shows a settled LANDED state instead of a stale countdown. */
  landed?: boolean;
  /** True when no viable descent trajectory reaches a safe touchdown (an optimal
   * burn still can't arrest the vessel in the remaining altitude): the hero
   * reads NO LANDING VECTOR. Distinct from a nominal committed burn (which HAS a
   * vector); never set that case. */
  noLandingVector?: boolean;
  /** The unavoidable touchdown speed (`bestSpeedAtImpact`, m/s): the killer fact
   * led under a NO LANDING VECTOR hero. Ignored unless `noLandingVector`. */
  impactSpeed?: number | null;
}

export function CommitLayer({
  regime,
  roundTripSeconds,
  live,
  mayInstruct,
  suicideBurnCountdown,
  commitInSeconds,
  committed,
  blindInSeconds,
  blind,
  landed = false,
  noLandingVector = false,
  impactSpeed = null,
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

  let heroValue: ReactNode;
  let heroCaption: string;
  let heroTone: ReadoutTone;
  let urgent = false;
  if (landed) {
    // Settled on the surface: the descent is over, so no commit / blind / burn
    // countdown: a confident touchdown confirmation instead.
    heroValue = "LANDED";
    heroCaption = "TOUCHDOWN CONFIRMED";
    heroTone = "go";
  } else if (noLandingVector) {
    // No descent trajectory reaches a safe touchdown: the vessel is committed
    // to a hard impact whatever it does now. Distinct from a nominal commit.
    heroValue = "NO LANDING VECTOR";
    heroCaption = "";
    heroTone = "alert";
  } else if (regime === "no-path") {
    // Neither hero is answerable without a link. The ignition countdown assumes
    // a closed real-time loop and the burn-GO clock assumes a known delay, so
    // picking either one states something about the link that nothing has told
    // us. Falling through to the live arm here reads "SUICIDE BURN", which is
    // exactly that unearned claim.
    heroValue = NULL_DISPLAY;
    heroCaption = "BURN TIMING NEEDS A LINK";
    heroTone = "default";
  } else if (!mayInstruct) {
    // Described, not instructed. The board beside this still carries the descent
    // picture from the best values available; this is the number an operator would
    // ACT on at a named moment, so it is the one that is withheld.
    //
    // After the `no-path` arm deliberately: when there is no link at all, "needs a
    // link" is the more specific answer and the operator can act on it. This arm is
    // for a link that is delivering while these particular readings are not current.
    heroValue = NULL_DISPLAY;
    heroCaption = "BURN TIMING NEEDS CURRENT TELEMETRY";
    heroTone = "default";
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
      heroValue = <Countdown value={countdown} clock precise />;
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
      heroValue = <Countdown value={commitInSeconds} clock precise />;
      heroTone = "warning";
    }
  }

  // The instantaneous ignition cue AND a no-landing-vector (imminent unavoidable
  // impact) interrupt (assertive): both are ABORT-class. Uncommandable / blind
  // are sustained states, announced politely, per the a11y rule that reserves
  // assertive for ABORT-class events.
  const alarmed = urgent || noLandingVector;

  return (
    <Section
      role={alarmed ? "alert" : "status"}
      aria-live={alarmed ? "assertive" : "polite"}
    >
      <Readout $tone={heroTone}>
        {heroValue}
        {heroCaption && <ReadoutCaption>{heroCaption}</ReadoutCaption>}
      </Readout>

      {/* Lead with the killer fact: under NO LANDING VECTOR the vessel is
            committed to a hard impact, so the unavoidable touchdown speed is the
            single number that matters, everything else (fuel, thrust, site) is
            moot. */}
      {noLandingVector && impactSpeed != null && (
        <Readout $tone="alert">
          <Unit value={value("m/s", impactSpeed)} format="m/s" decimals={0} />
          <ReadoutCaption>UNAVOIDABLE IMPACT</ReadoutCaption>
        </Readout>
      )}

      {/* Deliberately no UNCOMMANDABLE or PAST COMMIT POINT banner here. Both
            say the same thing as each other, and as the header: the round trip
            is longer than the window left, so nothing you send now lands in
            time. The round trip IS the instrument datum and it sits in the
            panel header beside the regime, so the operator reads the
            arithmetic rather than its conclusion twice in two vocabularies. */}
    </Section>
  );
}
