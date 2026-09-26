/**
 * The delay-native layer of the landing widget: under signal delay a landing cannot be hand-flown, so the question becomes whether the burn was committed before the vessel went blind.
 *
 * - Regime pill and round trip
 * - Hero: live, the ignition countdown; delayed, the burn-GO clock (the last instant a GO can still reach the vessel, T_ignition - N), then BURN LOCKED
 *
 * An instrument, not a command surface: gear and brakes are fired from the operator's own action-group widgets.
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
  /**
   * True when the loop is real-time. A `no-path` regime is NOT live: an unknown
   * link takes its own hero arm below rather than borrowing this one.
   */
  live: boolean;
  /** Whether an instruction may be named: every input the burn solve rests on is current. A burn instant from a propagated position is wrong, not dated, so the hero refuses rather than describes. */
  mayInstruct: boolean;
  suicideBurnCountdown: number | null;
  commitInSeconds: number | null;
  committed: boolean;
  /** True once the vessel has touched down: the descent clocks are void and the hero shows LANDED. */
  landed?: boolean;
  /** True when even an optimal burn cannot arrest the vessel in the remaining altitude; distinct from a nominal committed burn. */
  noLandingVector?: boolean;
  /** The unavoidable touchdown speed (`bestSpeedAtImpact`, m/s), led under a NO LANDING VECTOR hero. */
  impactSpeed?: number | null;
}

export function CommitLayer({
  regime,
  live,
  mayInstruct,
  suicideBurnCountdown,
  commitInSeconds,
  committed,
  landed = false,
  noLandingVector = false,
  impactSpeed = null,
}: Readonly<CommitLayerProps>) {
  const countdown = suicideBurnCountdown;

  let heroValue: ReactNode;
  let heroCaption: string;
  let heroTone: ReadoutTone;
  let urgent = false;
  if (landed) {
    heroValue = "LANDED";
    heroCaption = "TOUCHDOWN CONFIRMED";
    heroTone = "go";
  } else if (noLandingVector) {
    // Committed to a hard impact whatever it does now.
    heroValue = "NO LANDING VECTOR";
    heroCaption = "";
    heroTone = "alert";
  } else if (regime === "no-path") {
    // Both heroes assume something about the link (a closed loop, a known delay) that nothing has told us.
    heroValue = NULL_DISPLAY;
    heroCaption = "BURN TIMING NEEDS A LINK";
    heroTone = "default";
  } else if (!mayInstruct) {
    // The number an operator acts on is withheld while the board describes; after `no-path`, since "needs a link" is the more specific answer.
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
    // The last instant a human GO can still reach the vessel to start the burn (T_ignition - N).
    heroCaption = "BURN GO IN";
    if (committed) {
      heroValue = "BURN LOCKED";
      heroTone = "alert";
      // Past the deadline a GO cannot arrive in time, so the burn plan is locked.
      heroCaption = "";
    } else if (commitInSeconds == null) {
      heroValue = NULL_DISPLAY;
      heroTone = "default";
    } else {
      heroValue = <Countdown value={commitInSeconds} clock precise />;
      heroTone = "warning";
    }
  }

  // The ignition cue and a no-landing-vector are ABORT-class, so assertive; every other state is polite.
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

      {/* Under NO LANDING VECTOR the unavoidable touchdown speed is the one number that matters. */}
      {noLandingVector && impactSpeed != null && (
        <Readout $tone="alert">
          <Unit value={value("m/s", impactSpeed)} format="m/s" decimals={0} />
          <ReadoutCaption>UNAVOIDABLE IMPACT</ReadoutCaption>
        </Readout>
      )}

      {/* No UNCOMMANDABLE or COMMIT POINT banner: the round trip in the panel header already states it. */}
    </Section>
  );
}
