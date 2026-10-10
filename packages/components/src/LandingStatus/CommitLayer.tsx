/**
 * The delay-native layer of the landing widget: under signal delay a landing cannot be hand-flown, so the question becomes whether the burn was committed before the vessel went blind.
 *
 * - Regime pill and round trip
 * - Hero: live, the ignition countdown; delayed, the burn-GO clock (the last instant a GO can still reach the vessel, T_ignition - N), then BURN LOCKED
 *
 * An instrument, not a command surface: gear and brakes are fired from the operator's own action-group widgets.
 */

import { type Tone, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  NULL_DISPLAY,
  Readout,
  ReadoutCaption,
  Section,
  Stack,
  Unit,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type { LandingRegime } from "./clocks";

export const REGIME_LABEL: Record<LandingRegime, string> = {
  live: "LIVE",
  staged: "STAGED",
  autonomous: "AUTONOMOUS",
  "no-path": "NO LINK",
};

export const REGIME_TONE: Record<LandingRegime, Tone> = {
  live: "go",
  staged: "warn",
  autonomous: "warn",
  "no-path": "neutral",
};

const IMPACT_CAPTION = "BEST-BURN IMPACT";

/** The craft's parachutes as `vessel.landing` reports them; each field null when unsent. */
export interface ParachuteStatus {
  deployment: string | null;
  safety: string | null;
  fullDeployAltitude: Value<"m"> | null;
}

const CHUTE_LINE: Record<string, { text: string; tone: Tone }> = {
  none: { text: "NO PARACHUTE", tone: "warn" },
  stowed: { text: "CHUTE STOWED", tone: "neutral" },
  armed: { text: "CHUTE ARMED", tone: "info" },
  "semi-deployed": { text: "CHUTE SEMI-DEPLOYED", tone: "info" },
  deployed: { text: "CHUTE DEPLOYED", tone: "go" },
  cut: { text: "CHUTE CUT", tone: "warn" },
};

const CHUTE_SAFETY: Record<string, { text: string; tone: Tone | null }> = {
  safe: { text: "SAFE TO OPEN", tone: null },
  risky: { text: "RISKY TO OPEN", tone: "caution" },
  unsafe: { text: "UNSAFE TO OPEN", tone: "nogo" },
};

/** The parachute line for a craft with no engine: its state, the game's rating of opening it now while it is not yet open, and the height it opens fully at while armed or opening. Null when nothing is known. */
function parachuteLine(parachute: ParachuteStatus | undefined): ReactNode {
  const line = parachute?.deployment
    ? CHUTE_LINE[parachute.deployment]
    : undefined;
  if (!parachute || !line) return null;
  const safety = parachute.safety ? CHUTE_SAFETY[parachute.safety] : undefined;
  const opening =
    (parachute.deployment === "armed" ||
      parachute.deployment === "semi-deployed") &&
    parachute.fullDeployAltitude?.isFinite()
      ? parachute.fullDeployAltitude
      : null;
  const height = opening ? writeQuantity(opening, { decimals: 0 }) : null;
  const words = [safety?.text, height ? "FULL AT" : undefined]
    .filter(Boolean)
    .join(" · ");
  return (
    <Readout tone={safety?.tone ?? line.tone}>
      {line.text}{" "}
      {words && (
        <ReadoutCaption>
          {words}
          {/* A unit keeps its own case: a caption's capitals would turn km into KM. */}
          {height && <span style={{ textTransform: "none" }}> {height}</span>}
        </ReadoutCaption>
      )}
    </Readout>
  );
}

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
  /** The touchdown speed of the best burn started now (`bestSpeedAtImpact`, m/s); the row holds the absent-value token when there is none. */
  impactSpeed?: number | null;
  /** True while the engines are lit, from a reading of now: the headline reads BURNING in place of the countdown to a burn that has begun. */
  burning?: boolean;
  /** False for a craft with no engine to burn (none, no thrust, or none reported): the block says nothing of a burn. True when omitted. */
  engine?: boolean;
  /** The craft's parachutes, from `vessel.landing`, for a craft with no engine: how far they have opened, whether opening the rest is safe, and the height they open fully at. Omitted or all null, the row says nothing. */
  parachute?: ParachuteStatus;
}

interface Hero {
  value: ReactNode;
  caption: string;
  tone: Tone;
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
  burning = false,
}: Readonly<CommitLayerProps>): Hero {
  const hero = (
    value: ReactNode,
    caption: string,
    tone: Tone,
    urgent = false,
  ): Hero => ({ value, caption, tone, urgent });

  if (landed) return hero("LANDED", "TOUCHDOWN CONFIRMED", "go");
  // Committed to a hard impact whatever it does now.
  if (noLandingVector) return hero("NO LANDING VECTOR", "", "nogo");
  // A countdown to a burn that is already under way would be a falsehood, so the engines' own thrust takes its place.
  if (burning) return hero("BURNING", "", "warn");
  // Both heroes assume something about the link (a closed loop, a known delay) that nothing has told us.
  if (regime === "no-path") {
    return hero(NULL_DISPLAY, "BURN TIMING NEEDS A LINK", "neutral");
  }
  // The number an operator acts on is withheld while the board describes; after `no-path`, since "needs a link" is the more specific answer.
  if (!mayInstruct) {
    return hero(NULL_DISPLAY, "BURN TIMING NEEDS CURRENT TELEMETRY", "neutral");
  }
  if (centreOfMass) {
    return hero(NULL_DISPLAY, live ? "SUICIDE BURN" : "BURN GO IN", "neutral");
  }
  if (live) {
    if (countdown == null) return hero(NULL_DISPLAY, "SUICIDE BURN", "neutral");
    if (countdown <= 0) return hero("IGNITE", "SUICIDE BURN", "nogo", true);
    const urgent = countdown <= 5;
    return hero(
      <Countdown value={countdown} clock precise />,
      "SUICIDE BURN",
      urgent ? "nogo" : "warn",
      urgent,
    );
  }
  // Past the last instant a human GO can still reach the vessel (T_ignition - N), the burn plan is locked.
  if (committed) return hero("BURN LOCKED", "", "nogo");
  if (commitInSeconds == null)
    return hero(NULL_DISPLAY, "BURN GO IN", "neutral");
  return hero(
    <Countdown value={commitInSeconds} clock precise />,
    "BURN GO IN",
    "warn",
  );
}

export function CommitLayer(props: Readonly<CommitLayerProps>) {
  const { noLandingVector = false, impactSpeed = null, engine = true } = props;
  // Nothing to burn means no countdown and no best burn to speak of; a touchdown is still a touchdown. The live region stays mounted either way, so the touchdown is announced.
  if (!engine) {
    // One row in every state: the parachutes on the way down, LANDED once down, blank while nothing is known, so no change of state moves what sits below the block.
    return (
      <Section role="status" aria-live="polite">
        {props.landed ? (
          <Readout tone="go">LANDED</Readout>
        ) : (
          (parachuteLine(props.parachute) ?? (
            <Readout>
              <span aria-hidden="true">{"\u00a0"}</span>
            </Readout>
          ))
        )}
      </Section>
    );
  }
  const {
    value: heroValue,
    caption: heroCaption,
    tone: heroTone,
    urgent,
  } = resolveHero(props);

  // A figure from the burn solve is withheld like the hero's instruction while any input to it is dated.
  const showImpact = impactSpeed != null && !props.landed && props.mayInstruct;

  // The ignition cue and a no-landing-vector are ABORT-class, so assertive; every other state is polite.
  const alarmed = urgent || noLandingVector;

  return (
    <Section
      role={alarmed ? "alert" : "status"}
      aria-live={alarmed ? "assertive" : "polite"}
    >
      {/* Two rows in every state, so a change of state never adds or takes away a row; in a tile too narrow for a row's words they wrap rather than being cut off. */}
      <Stack>
        <Readout tone={heroTone}>
          {heroValue}
          {heroCaption && <ReadoutCaption>{heroCaption}</ReadoutCaption>}
        </Readout>
        <Readout tone={noLandingVector ? "nogo" : "neutral"}>
          {showImpact ? (
            <Unit value={value("m/s", impactSpeed)} format="m/s" decimals={0} />
          ) : (
            NULL_DISPLAY
          )}
          <ReadoutCaption>{IMPACT_CAPTION}</ReadoutCaption>
        </Readout>
      </Stack>
    </Section>
  );
}
