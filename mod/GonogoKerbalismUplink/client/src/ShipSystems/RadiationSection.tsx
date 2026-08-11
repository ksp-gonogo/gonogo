import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  Fill,
  GraphNotice,
  LineGraph,
  type LineGraphSeries,
  Stack,
  Unit,
  Value,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import type { KerbalismSpaceWeather } from "../__generated__/contract";
import { HIGH_RADIATION_RAD_PER_HOUR } from "../CrewSurvival/summary";
import { mag } from "../ecosystem";

// ---------------------------------------------------------------------------
// The radiation graph + belt/location readout, piece of the Ship Systems
// widget (see `index.tsx`'s render site). Fed straight off the
// `kerbalism.spaceweather` Topic: no Processor, same "nothing else shares
// this derivation" reasoning `SpaceWeather/badge.ts` and `CrewSurvival/
// summary.tsx` already use for the same Topic.
//
// The whole point of the two-line pairing is the GAP between them: ambient
// (`radiationRadPerSecond`) is what the environment is doing, shielded
// (`habitatRadiationRadPerSecond`) is what actually reaches the crew after
// the vessel's fixed shielding factor. A wide gap with shielded pinned under
// the threshold marker reads as "ambient is spiking, shielding is doing its
// job"; a gap that closes reads as "shielding isn't enough anymore".
// Per-kerbal lines are deliberately never drawn here: the rate itself is
// vessel-wide (Kerbalism's habitat radiation is a property of the vessel's
// shielding, not of any one Kerbal), see this widget's own doc comment / the
// task this was built against.
//
// The series wear IDENTITY hues at rest (ambient the muted text grey,
// shielded the calm info blue), never alarm colours: a permanently-red
// ambient trace shouted CRITICAL through every quiet cruise (operator
// feedback, the widget's own worst colour offender). Status enters only
// when a line's CURRENT reading crosses the 0.5 rad/h threshold: ambient
// escalates to warning amber (the environment is hot, shielding still
// deciding the outcome), shielded to nogo red (the crew is actually taking
// dose). The paired readouts below the graph escalate in step so colour
// never carries the reading alone.
//
// Renders as a SPARKLINE (`LineGraph`'s `variant="sparkline"`), not an
// engineering chart: operator feedback on the first pass called the plain
// `LineGraph` too technical for what is meant to be a glance-read trend.
// Area-shaded lines, no gridlines, still the same two series plus the
// safe-threshold marker. This is also the widget's LEAD section now
// (rendered first in `index.tsx`'s body), the attractive visual earns the
// top slot rather than being buried below the resource ledger.
//
// OPEN, not boxed: a second round of operator feedback called the graph too
// chart-like still, partly because it sat inside a `Card` (a boxy container
// that reads as "yet another gauge" in a widget that is already box-after-
// box) and only took a fraction of the row's width beside the belt badges.
// The `Card` wrapper is gone; the graph now spans the widget's FULL width
// and breathes on the Panel's own background, the way a sparkline is meant
// to sit inline with surrounding text rather than fenced off in its own
// instrument housing.
//
// The belt/location badges are gone too: belt membership is a neutral
// status fact (which magnetic zone the vessel is in right now), not an
// alert, so a red "Inner belt" pill was miscommunicating severity that
// belongs to the dose-rate readouts, not the location. It renders as plain
// low-emphasis text under the graph instead (see `locationLabel` below).
//
// The 0.5 rad/h boundary draws as a FIXED ~24px tick at the frame's left
// edge with the "0.5" level beside it (`LineGraph`'s
// `thresholdStyle="marker"`), an axis annotation rather than a rule: a
// full-width dashed line made the boundary the loudest thing in the frame,
// and the earlier centred marker stretched with the viewBox so its length
// changed with every widget width. The muted warning amber carries "this is
// the danger level" quietly.
//
// The Y domain is CLAMPED to a 1-2-2.5-5-10 nice ceiling (never below twice
// the threshold), instead of hugging the live data extent: an extent-fitted
// domain rescaled the whole frame on every sample, so the threshold marker
// and both traces crawled continuously, the live jank operators called out.
// With the clamp the frame is still until a trace actually crosses into the
// next step.
// ---------------------------------------------------------------------------

export interface RadiationSample {
  ut: number;
  ambientRadPerSec: number;
  shieldedRadPerSec: number;
}

/** 10 minutes of history: long enough to show a storm's onset against a
 *  quiet baseline, same "long enough to read a trend" window this widget's
 *  own `SOON_EMPTY_SEC` uses for the equivalent judgment call on a drain. */
export const RADIATION_WINDOW_SEC = 600;

/** Minimum UT gap between two recorded points. Telemetry frames land far
 *  more often than a slow-moving dose rate needs to be redrawn; without a
 *  floor, a 600s window at a typical tick rate would accumulate thousands of
 *  points for a trend that reads identically at a few hundred. */
const MIN_SAMPLE_GAP_UT = 2;

/**
 * Pure buffer-management step: append `sample` to `buffer`, trimmed to
 * `windowSec` and throttled to `minGapUt`. Exported for direct unit testing
 * without mounting a component or driving React state.
 */
export function pushRadiationSample(
  buffer: readonly RadiationSample[],
  sample: RadiationSample,
  windowSec: number = RADIATION_WINDOW_SEC,
  minGapUt: number = MIN_SAMPLE_GAP_UT,
): readonly RadiationSample[] {
  const last = buffer[buffer.length - 1];
  if (last) {
    // Time moved backwards further than sampling jitter accounts for (a
    // quickload, a replay scrub): start the trend over rather than
    // stitching a rewound history onto the old one.
    if (sample.ut < last.ut - minGapUt) return [sample];
    if (sample.ut - last.ut < minGapUt) return buffer;
  }
  const next = [...buffer, sample];
  const cutoff = sample.ut - windowSec;
  const start = next.findIndex((s) => s.ut >= cutoff);
  return start <= 0 ? next : next.slice(start);
}

/** Rolling client-side sample buffer: the app has no server-side history for
 *  this Topic, so the graph builds its own by watching the live stream. */
function useRadiationHistory(
  weather: KerbalismSpaceWeather | undefined,
  utNow: number | undefined,
): readonly RadiationSample[] {
  const [history, setHistory] = useState<readonly RadiationSample[]>([]);
  const ambientRadPerSec = mag(weather?.radiationRadPerSecond);
  const shieldedRadPerSec = mag(
    weather?.habitatRadiationRadPerSecond ?? weather?.radiationRadPerSecond,
  );
  const hasWeather = weather !== undefined;

  useEffect(() => {
    if (!hasWeather || utNow === undefined) return;
    setHistory((prev) =>
      pushRadiationSample(prev, {
        ut: utNow,
        ambientRadPerSec,
        shieldedRadPerSec,
      }),
    );
  }, [hasWeather, utNow, ambientRadPerSec, shieldedRadPerSec]);

  return history;
}

const RAD_PER_SEC_TO_RAD_PER_HOUR = 3600;

function toRadPerHourSeries(
  history: readonly RadiationSample[],
  pick: (s: RadiationSample) => number,
): LineGraphSeries["points"] {
  return history.map((s) => ({
    x: s.ut,
    y: pick(s) * RAD_PER_SEC_TO_RAD_PER_HOUR,
  }));
}

/**
 * Smallest 1-2-2.5-5-10 "nice" number at or above `v`: the graph's stable
 * Y ceiling. Stepped rather than continuous so the frame rescales only when
 * a trace genuinely crosses into the next step, not on every sample.
 * Exported for direct unit testing.
 */
export function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(v));
  const mantissa = v / base;
  for (const step of [1, 2, 2.5, 5]) {
    if (mantissa <= step) return step * base;
  }
  return 10 * base;
}

/**
 * Magnitude-aware decimals for a rad/h readout: `21.6` needs one decimal,
 * `0.216` needs three, and the kind's fixed four ("21.6000") implied a
 * precision the reading does not have. Exported for direct unit testing.
 */
export function doseRateDecimals(radPerHour: number): number {
  const abs = Math.abs(radPerHour);
  if (abs >= 100) return 0;
  if (abs >= 10) return 1;
  if (abs >= 1) return 2;
  return 3;
}

/**
 * Plain-text belt/location read from the raw spaceweather flags: neutral
 * status, not a severity call, so this returns a label string for
 * low-emphasis text under the graph rather than a badge/severity pairing.
 * Belt membership (the more specific fact) is named alongside the general
 * magnetosphere read when a vessel is inside one; both belts can show
 * together at a boundary crossing.
 */
function locationLabel(weather: KerbalismSpaceWeather): string {
  const labels: string[] = [];
  if (weather.innerBelt === true) labels.push("Inner belt");
  if (weather.outerBelt === true) labels.push("Outer belt");
  if (labels.length === 0) {
    labels.push(weather.magnetosphere === true ? "Magnetosphere" : "None");
  }
  return labels.join(" · ");
}

export interface RadiationSectionProps {
  weather: KerbalismSpaceWeather | undefined;
  /** Current view UT (`useUtNow()`), the x-axis this widget's rolling buffer keys off. */
  utNow: number | undefined;
}

/**
 * Renders nothing when no `kerbalism.spaceweather` frame has ever landed
 * (an install without the Kerbalism radiation feature, or before the first
 * frame arrives), matching every other spaceweather-fed slot in this
 * package (`badge.ts`, `CrewSurvival/summary.tsx`): a quiet/absent reading
 * carries no widget clutter.
 */
export function RadiationSection({ weather, utNow }: RadiationSectionProps) {
  const history = useRadiationHistory(weather, utNow);
  if (!weather) return null;

  const hasTrend = history.length >= 2;
  const location = locationLabel(weather);
  // Always a real Value (never undefined): an unreported field reads as a
  // genuine "0 rad/h" rather than a blank readout beside a live label.
  const ambientRadPerSec = mag(weather.radiationRadPerSecond);
  const shieldedRadPerSec = mag(
    weather.habitatRadiationRadPerSecond ?? weather.radiationRadPerSecond,
  );
  const ambientValue = value("rad/s", ambientRadPerSec);
  const shieldedValue = value("rad/s", shieldedRadPerSec);
  const ambientRadPerHour = ambientRadPerSec * RAD_PER_SEC_TO_RAD_PER_HOUR;
  const shieldedRadPerHour = shieldedRadPerSec * RAD_PER_SEC_TO_RAD_PER_HOUR;
  // Escalation is per-line and threshold-gated (see the header comment):
  // identity hues at rest, warning amber when the ENVIRONMENT is hot, nogo
  // red only when the CREW-side reading itself is over the line.
  const ambientHigh = ambientRadPerHour > HIGH_RADIATION_RAD_PER_HOUR;
  const shieldedHigh = shieldedRadPerHour > HIGH_RADIATION_RAD_PER_HOUR;

  const ambientPoints = toRadPerHourSeries(history, (s) => s.ambientRadPerSec);
  const shieldedPoints = toRadPerHourSeries(
    history,
    (s) => s.shieldedRadPerSec,
  );
  const series: LineGraphSeries[] = [
    {
      id: "ambient",
      label: "Ambient",
      color: ambientHigh
        ? "var(--color-status-warning-bg)"
        : "var(--color-text-muted)",
      points: ambientPoints,
    },
    {
      id: "shielded",
      label: "Shielded",
      color: shieldedHigh
        ? "var(--color-status-nogo-bg)"
        : "var(--color-status-info-fg)",
      points: shieldedPoints,
    },
  ];

  // Stable frame: 0 up to a stepped nice ceiling, never below twice the
  // threshold so the 0.5 marker always has an honest place mid-frame.
  const dataMaxRadPerHour = Math.max(
    ambientRadPerHour,
    shieldedRadPerHour,
    ...ambientPoints.map((p) => p.y),
    ...shieldedPoints.map((p) => p.y),
  );
  const yMax = niceCeil(
    Math.max(dataMaxRadPerHour, HIGH_RADIATION_RAD_PER_HOUR * 2),
  );

  return (
    // No Card, no side-by-side badge column: the graph is OPEN and spans
    // the widget's full width (see the header doc comment). Belt/location
    // moved below as plain low-emphasis text; `role="status"` stays on that
    // text (not a Stack of badges) since it is still the one bit of this
    // section that changes without the operator watching for it.
    <Stack gap="xs">
      <Fill style={{ height: 96 }}>
        <LineGraph
          series={series}
          variant="sparkline"
          yDomain={[0, yMax]}
          thresholds={[
            {
              id: "safe",
              label: "Safe threshold",
              value: HIGH_RADIATION_RAD_PER_HOUR,
              valueText: String(HIGH_RADIATION_RAD_PER_HOUR),
            },
          ]}
          thresholdStyle="marker"
          height={96}
          ariaLabel="Radiation dose rate trend: ambient versus shielded, last 10 minutes"
        />
        {!hasTrend && (
          <GraphNotice placement="overlay">
            Collecting radiation history…
          </GraphNotice>
        )}
      </Fill>
      <Cluster
        gap="md"
        justify="between"
        style={{ marginTop: "var(--space-2)" }}
      >
        {/* Identity tones at rest (grey/info-blue, matching the traces),
            escalation only over the threshold. `warn`'s bare -fg token is
            near-black on this dark surface, so the escalated ambient reads
            through the same -fg-muted override every warning-toned text on
            a panel surface uses (see LedgerBody's residual note). */}
        <Value
          tone={ambientHigh ? "warn" : "default"}
          size="xs"
          style={
            ambientHigh
              ? { color: "var(--color-status-warning-fg-muted)" }
              : undefined
          }
        >
          Ambient{" "}
          <Unit
            value={ambientValue}
            decimals={doseRateDecimals(ambientRadPerHour)}
          />
        </Value>
        <Value tone={shieldedHigh ? "nogo" : "info"} size="xs">
          Shielded{" "}
          <Unit
            value={shieldedValue}
            decimals={doseRateDecimals(shieldedRadPerHour)}
          />
        </Value>
      </Cluster>
      <Value tone="muted" size="xs" role="status" aria-live="polite">
        {location}
      </Value>
    </Stack>
  );
}
