import type { KerbalismSpaceWeather } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  Fill,
  GraphNotice,
  LineGraph,
  type LineGraphSeries,
  type Severity,
  Stack,
  Unit,
  Value,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import { HIGH_RADIATION_RAD_PER_HOUR } from "../CrewSurvival/summary";
import { mag } from "../ecosystem";

// ---------------------------------------------------------------------------
// The radiation graph + belt/location readout, piece of the Ship Systems
// widget (see `index.tsx`'s render site). Fed straight off the
// `kerbalism.spaceweather` Topic: no Processor, same "nothing else shares
// this derivation" reasoning `SpaceWeather/badge.ts` and `CrewSurvival/
// summary.tsx` already use for the same Topic.
//
// The whole point of the red/blue pairing is the GAP between the two lines:
// ambient (red, `radiationRadPerSecond`) is what the environment is doing,
// shielded (blue, `habitatRadiationRadPerSecond`) is what actually reaches
// the crew after the vessel's fixed shielding factor. A wide gap with blue
// pinned under the threshold line reads as "ambient is spiking, shielding is
// doing its job"; a gap that closes reads as "shielding isn't enough
// anymore". Per-kerbal lines are deliberately never drawn here: the rate
// itself is vessel-wide (Kerbalism's habitat radiation is a property of the
// vessel's shielding, not of any one Kerbal), see this widget's own doc
// comment / the task this was built against.
//
// Renders as a SPARKLINE (`LineGraph`'s `variant="sparkline"`), not an
// engineering chart: operator feedback on the first pass called the plain
// `LineGraph` too technical for what is meant to be a glance-read trend.
// Area-shaded lines, no gridlines, still the same two series plus the
// dashed safe-threshold line. This is also the widget's LEAD section now
// (rendered first in `index.tsx`'s body), the attractive visual earns the
// top slot rather than being buried below the resource ledger.
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
 * Compact belt/location badges from the raw spaceweather flags. Belt
 * membership (the more specific, more severe fact) wins over the general
 * magnetosphere/unshielded read when a vessel is inside one; both belts can
 * show together at a boundary crossing.
 */
function locationBadges(
  weather: KerbalismSpaceWeather,
): Array<{ id: string; label: string; severity: Severity }> {
  const badges: Array<{ id: string; label: string; severity: Severity }> = [];
  if (weather.innerBelt === true) {
    badges.push({
      id: "inner-belt",
      label: "Inner belt",
      severity: "critical",
    });
  }
  if (weather.outerBelt === true) {
    badges.push({ id: "outer-belt", label: "Outer belt", severity: "warning" });
  }
  if (badges.length === 0) {
    badges.push(
      weather.magnetosphere === true
        ? { id: "magnetosphere", label: "Magnetosphere", severity: "nominal" }
        : { id: "unshielded", label: "Unshielded", severity: "info" },
    );
  }
  return badges;
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
  const badges = locationBadges(weather);
  // Always a real Value (never undefined): an unreported field reads as a
  // genuine "0 rad/h" rather than a blank readout beside a live label.
  const ambientValue = value("rad/s", mag(weather.radiationRadPerSecond));
  const shieldedValue = value(
    "rad/s",
    mag(weather.habitatRadiationRadPerSecond ?? weather.radiationRadPerSecond),
  );

  const series: LineGraphSeries[] = [
    {
      id: "ambient",
      label: "Ambient",
      color: "var(--color-status-nogo-bg)",
      points: toRadPerHourSeries(history, (s) => s.ambientRadPerSec),
    },
    {
      id: "shielded",
      label: "Shielded",
      color: "var(--color-status-info-fg)",
      points: toRadPerHourSeries(history, (s) => s.shieldedRadPerSec),
    },
  ];

  return (
    <Cluster gap="md" wrap align="start">
      <Card style={{ flex: "1 1 220px", minWidth: 0 }}>
        <Fill style={{ height: 96 }}>
          <LineGraph
            series={series}
            variant="sparkline"
            thresholds={[
              {
                id: "safe",
                label: "Safe threshold",
                value: HIGH_RADIATION_RAD_PER_HOUR,
                color: "var(--color-status-warning-fg-muted)",
              },
            ]}
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
          <Value tone="nogo" size="xs">
            Ambient <Unit value={ambientValue} />
          </Value>
          <Value tone="info" size="xs">
            Shielded <Unit value={shieldedValue} />
          </Value>
        </Cluster>
      </Card>
      <Stack
        gap="xs"
        role="status"
        aria-live="polite"
        style={{ flex: "0 0 auto" }}
      >
        {badges.map((b) => (
          <Badge key={b.id} severity={b.severity} size="sm">
            {b.label}
          </Badge>
        ))}
      </Stack>
    </Cluster>
  );
}
