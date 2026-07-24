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
 * - Gear / brakes commanded-vs-confirmed lifecycle, made prominent (under delay
 *   you fire the command and do not know for 2N seconds whether it took).
 *
 * Presentational: the clocks are derived upstream by `deriveDelayClocks`.
 */

import {
  Badge,
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
  "no-path": "LINK —",
};

const REGIME_TONE: Record<LandingRegime, ReadoutTone> = {
  live: "go",
  staged: "warning",
  autonomous: "alert",
  "no-path": "default",
};

export interface CommandRow {
  on: boolean | undefined;
  /** The `useCommand` status phase: idle / in-flight / confirmed / failed / lost. */
  phase: string;
  onToggle: () => void;
}

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
  gear: CommandRow;
  brakes: CommandRow;
}

function ConfigRow({
  label,
  on,
  phase,
  onToggle,
}: {
  label: string;
  on: boolean | undefined;
  phase: string;
  onToggle: () => void;
}) {
  const pending = phase === "in-flight";
  const failed = phase === "failed" || phase === "lost";
  const tone: "neutral" | "go" | "nogo" | "warn" = failed
    ? "nogo"
    : pending
      ? "warn"
      : on
        ? "go"
        : "neutral";
  const stateText = pending
    ? "sending…"
    : failed
      ? "no reply"
      : on === undefined
        ? "—"
        : on
          ? "on"
          : "off";
  return (
    <Cluster justify="between" gap="sm">
      <button type="button" onClick={onToggle} aria-label={`Toggle ${label}`}>
        {label}
      </button>
      <Badge tone={tone} size="sm">
        {stateText}
      </Badge>
    </Cluster>
  );
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
  gear,
  brakes,
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
          {roundTripSeconds != null && roundTripSeconds > 0 && (
            <Value tone="muted">
              RT {formatDuration(roundTripSeconds, { ms: true })}
            </Value>
          )}
        </Cluster>
      </Section>

      <Section
        role={alarmed ? "alert" : "status"}
        aria-live={alarmed ? "assertive" : "polite"}
      >
        <Readout $tone={heroTone}>
          {heroValue}
          <ReadoutCaption>{heroCaption}</ReadoutCaption>
        </Readout>

        {uncommandable && (
          <Value tone="accent" size="sm">
            UNCOMMANDABLE — round-trip{" "}
            {formatDuration(roundTripSeconds as number, { ms: true })} exceeds
            remaining {formatDuration(countdown as number, { ms: true })}
          </Value>
        )}

        {!live && blindInSeconds != null && (
          <Value tone={blind ? "accent" : "muted"} size="sm">
            {blind
              ? "BLIND — outcome determined"
              : `Blind in ${formatDuration(blindInSeconds, { ms: true })}`}
          </Value>
        )}
      </Section>

      <Section>
        <SectionTitle>Configuration</SectionTitle>
        <ConfigRow
          label="Gear"
          on={gear.on}
          phase={gear.phase}
          onToggle={gear.onToggle}
        />
        <ConfigRow
          label="Brakes"
          on={brakes.on}
          phase={brakes.phase}
          onToggle={brakes.onToggle}
        />
      </Section>
    </>
  );
}
