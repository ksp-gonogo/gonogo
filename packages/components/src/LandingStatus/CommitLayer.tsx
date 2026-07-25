/**
 * CommitLayer — the delay-native "soul" of the landing widget, and what makes it
 * gonogo's rather than a re-skinned KER. Under signal delay a landing cannot be
 * hand-flown, so the job shifts from "cue the burn" to "did I commit correctly
 * before I went blind":
 *
 * - Regime pill (LIVE / STAGED / AUTONOMOUS / LINK —) + round-trip.
 * - Hero: live → the ignition countdown; delayed → the Commit Clock (the last
 *   instant a GO can still reach the vessel) → COMMITTED once past it.
 * - UNCOMMANDABLE banner: when the round-trip exceeds the remaining burn window,
 *   a command sent now cannot be confirmed in time. Arguably the single most
 *   valuable thing this widget can say.
 * - Blind line: the outcome is fixed and merely not yet visible.
 *
 * Landing is an INSTRUMENT, not a command surface — gear/brakes are fired from
 * the operator's own action-group widgets placed alongside, so this layer holds
 * only decision-support (clocks, uncommandable, ignition cue), no commands.
 *
 * Presentational: the clocks are derived upstream by `deriveDelayClocks`.
 */

import {
  Cluster,
  formatDuration,
  Readout,
  ReadoutCaption,
  type ReadoutTone,
  Section,
  SectionTitle,
  StatusPill,
  Value,
} from "@ksp-gonogo/ui-kit";
import type { LandingRegime } from "./clocks";

const REGIME_LABEL: Record<LandingRegime, string> = {
  live: "LIVE",
  staged: "STAGED",
  autonomous: "AUTONOMOUS",
  "no-path": "NO LINK",
};

const REGIME_TONE: Record<LandingRegime, ReadoutTone> = {
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
}: Readonly<CommitLayerProps>) {
  const countdown = suicideBurnCountdown;

  // Uncommandable: a full round-trip no longer fits inside the remaining burn
  // window, so a command sent now cannot be confirmed (or corrected) in time.
  const uncommandable =
    roundTripSeconds != null &&
    roundTripSeconds > 0 &&
    countdown != null &&
    countdown > 0 &&
    roundTripSeconds > countdown;

  let heroValue: string;
  let heroCaption: string;
  let heroTone: ReadoutTone;
  let urgent = false;
  if (live) {
    heroCaption = "SUICIDE BURN";
    if (countdown == null) {
      heroValue = "—";
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
    heroCaption = "COMMIT IN";
    if (committed) {
      heroValue = "COMMITTED";
      heroTone = "alert";
      // Past the commit point the "COMMIT IN" caption is stale/contradictory —
      // the value already says COMMITTED, so drop the caption.
      heroCaption = "";
    } else if (commitInSeconds == null) {
      heroValue = "—";
      heroTone = "default";
    } else {
      heroValue = `T−${formatDuration(commitInSeconds, { ms: true })}`;
      heroTone = "warning";
    }
  }

  // Only the instantaneous ignition cue interrupts (assertive). Uncommandable /
  // blind are sustained states — announce them politely, per the a11y rule that
  // reserves assertive for ABORT-class events.
  const alarmed = urgent;

  return (
    <>
      <Section>
        <SectionTitle>Delay</SectionTitle>
        <Cluster justify="start" gap="sm">
          <StatusPill $tone={REGIME_TONE[regime]}>
            {REGIME_LABEL[regime]}
          </StatusPill>
        </Cluster>
        {/* RT on its OWN line (not crammed beside the pill) so the readouts +
            TWR above can move up and fill the right column. */}
        {roundTripSeconds != null && roundTripSeconds > 0 && (
          <Value tone="muted">
            RT {formatDuration(roundTripSeconds, { ms: true })}
          </Value>
        )}
      </Section>

      <Section
        role={alarmed ? "alert" : "status"}
        aria-live={alarmed ? "assertive" : "polite"}
      >
        <Readout $tone={heroTone}>
          {heroValue}
          {heroCaption && <ReadoutCaption>{heroCaption}</ReadoutCaption>}
        </Readout>

        {/* Fixed two-line slot. UNCOMMANDABLE pops in and out mid-descent; if
            the lines were conditionally mounted the whole widget would jump
            taller/shorter each time. Reserve the space always (same two lines,
            same sizes) and only flip visibility, so it appears/clears in place
            without reflowing. The lines are inline <Value> spans, so the slot
            stacks them as a flex column (otherwise they'd flow onto one line). */}
        <div
          data-testid="uncommandable-slot"
          aria-hidden={uncommandable ? undefined : true}
          style={{
            display: "flex",
            flexDirection: "column",
            ...(uncommandable ? undefined : { visibility: "hidden" }),
          }}
        >
          <Value tone="accent" size="sm">
            {uncommandable ? "UNCOMMANDABLE" : " "}
          </Value>
          <Value tone="accent" size="xs">
            {uncommandable
              ? `RT ${formatDuration(roundTripSeconds as number, {
                  ms: true,
                })} > ${formatDuration(countdown as number, { ms: true })} left`
              : " "}
          </Value>
        </div>

        {!live && blindInSeconds != null && (
          <Value tone={blind ? "accent" : "muted"} size="sm">
            {blind
              ? "BLIND"
              : `Blind in ${formatDuration(blindInSeconds, { ms: true })}`}
          </Value>
        )}
      </Section>
    </>
  );
}
