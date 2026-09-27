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
  /** The height is the root part's: the burn solve is biased by the lowest point's offset, so no burn timing is named. */
  centreOfMass?: boolean;
  /** True once the vessel has touched down: the descent clocks are void and the hero shows LANDED. */
  landed?: boolean;
  /** True when even an optimal burn cannot arrest the vessel in the remaining altitude; distinct from a nominal committed burn. */
  noLandingVector?: boolean;
  /** The unavoidable touchdown speed (`bestSpeedAtImpact`, m/s), led under a NO LANDING VECTOR hero. */
  impactSpeed?: number | null;
}

interface Hero {
  value: ReactNode;
  caption: string;
  tone: ReadoutTone;
  urgent: boolean;
}

function resolveHero({
  regime,
  live,
  mayInstruct,
  suicideBurnCountdown: countdown,
  commitInSeconds,
  committed,
  centreOfMass = false,
  landed = false,
  noLandingVector = false,
}: Readonly<CommitLayerProps>): Hero {
  const hero = (
    value: ReactNode,
    caption: string,
    tone: ReadoutTone,
    urgent = false,
  ): Hero => ({ value, caption, tone, urgent });

  if (landed) return hero("LANDED", "TOUCHDOWN CONFIRMED", "go");
  // Committed to a hard impact whatever it does now.
  if (noLandingVector) return hero("NO LANDING VECTOR", "", "alert");
  // Both heroes assume something about the link (a closed loop, a known delay) that nothing has told us.
  if (regime === "no-path") {
    return hero(NULL_DISPLAY, "BURN TIMING NEEDS A LINK", "default");
  }
  // The number an operator acts on is withheld while the board describes; after `no-path`, since "needs a link" is the more specific answer.
  if (!mayInstruct) {
    return hero(NULL_DISPLAY, "BURN TIMING NEEDS CURRENT TELEMETRY", "default");
  }
  if (centreOfMass) {
    return hero(NULL_DISPLAY, live ? "SUICIDE BURN" : "BURN GO IN", "default");
  }
  if (live) {
    if (countdown == null) return hero(NULL_DISPLAY, "SUICIDE BURN", "default");
    if (countdown <= 0) return hero("IGNITE", "SUICIDE BURN", "alert", true);
    const urgent = countdown <= 5;
    return hero(
      <Countdown value={countdown} clock precise />,
      "SUICIDE BURN",
      urgent ? "alert" : "warning",
      urgent,
    );
  }
  // Past the last instant a human GO can still reach the vessel (T_ignition - N), the burn plan is locked.
  if (committed) return hero("BURN LOCKED", "", "alert");
  if (commitInSeconds == null)
    return hero(NULL_DISPLAY, "BURN GO IN", "default");
  return hero(
    <Countdown value={commitInSeconds} clock precise />,
    "BURN GO IN",
    "warning",
  );
}

export function CommitLayer(props: Readonly<CommitLayerProps>) {
  const { noLandingVector = false, impactSpeed = null } = props;
  const {
    value: heroValue,
    caption: heroCaption,
    tone: heroTone,
    urgent,
  } = resolveHero(props);

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
    </Section>
  );
}
