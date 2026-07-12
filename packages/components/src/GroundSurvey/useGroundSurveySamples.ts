import { useTelemetry } from "@ksp-gonogo/core";
import { useEffect, useReducer, useRef } from "react";

export interface SurveySample {
  /** Unix ms — wall-clock time this sample was received (`Date.now()` at
   *  the moment the vessel.flight ingest that produced it landed). */
  t: number;
  /** Terrain elevation above sea level, m. Median-filtered hft. */
  terrain: number;
  /**
   * `real` while sampling above the freeze threshold; `frozen` once we drop
   * below it — at which point we keep extending the time-axis using the
   * last real terrain elevation, so the strip's right edge tracks current
   * time and the visible window doesn't go stale during descent.
   */
  kind: "real" | "frozen";
}

export interface SurveyResult {
  samples: readonly SurveySample[];
  /**
   * - `idle` — no telemetry yet, OR vessel above the survey ceiling.
   * - `active` — sampling between ceiling and freeze threshold.
   * - `frozen` — below the freeze threshold; verdict locked.
   */
  surveyState: "idle" | "active" | "frozen" | "above-ceiling";
  altitude: number | null;
  heightFromTerrain: number | null;
  surfaceSpeed: number | null;
  predictedLat: number | null;
  predictedLon: number | null;
  body: string | null;
}

export interface UseGroundSurveyOpts {
  /** Legacy `DataSource` id `v.body`/`v.splashed`/`land.predictedLat`/
   *  `land.predictedLon` route through (via the `useTelemetry` mapTopic
   *  shim — see this hook's own doc comment for why these four stay on the
   *  2-arg legacy-key overload while altitude/heightFromTerrain/
   *  surfaceSpeed read the canonical `vessel.flight` Topic directly).
   *  Default `"data"`. */
  sourceId?: string;
  /** Rolling time window for the strip, ms. Default 120 000 (2 min). */
  windowMs?: number;
  /** Below this hft (m) the survey freezes. Default 1000. */
  freezeBelowM?: number;
  /**
   * Above this hft (m) the survey is idle — terrain elevation samples taken
   * from orbit smear over hundreds of km of ground and the resulting
   * smoothness verdict is meaningless for landing-site assessment. Default
   * 10 000 (10 km AGL) — well below LKO, well above any useful
   * reconnaissance pass.
   */
  surveyCeilingM?: number;
}

interface InternalState {
  samples: SurveySample[];
  altitude: number | null;
  heightFromTerrain: number | null;
  surfaceSpeed: number | null;
  body: string | null;
  splashed: boolean;
  /** Last 3 raw heightFromTerrain values — median-filtered before terrain calc. */
  hftWindow: number[];
  /** Most recent real terrain elevation; reused while frozen. */
  lastRealTerrain: number | null;
}

const DEFAULT_OPTS: Required<UseGroundSurveyOpts> = {
  sourceId: "data",
  windowMs: 120_000,
  freezeBelowM: 1000,
  surveyCeilingM: 10_000,
};

function freshState(): InternalState {
  return {
    samples: [],
    altitude: null,
    heightFromTerrain: null,
    surfaceSpeed: null,
    body: null,
    splashed: false,
    hftWindow: [],
    lastRealTerrain: null,
  };
}

/**
 * Reads `vessel.flight` (altitude/heightFromTerrain/surfaceSpeed — a single
 * atomic per-tick capture, `KspHost.BuildFlight`) as a canonical Topic read
 * (no legacy fallback, matches `useTopology`'s posture — see that hook's
 * own doc comment). Body/splashed/predicted-landing stay on the 2-arg
 * `useTelemetry(sourceId, key)` mapTopic-shimmed overload — those four
 * resolve to `vessel.state.*` (a DERIVED, client-side-only channel with no
 * `[SitrepTopic]` tag of its own, so it has no canonical single-arg Topic
 * id to read directly) via the SAME `v.body`/`v.splashed`/
 * `land.predictedLat`/`land.predictedLon` legacy keys every other migrated
 * widget already uses for this shim, zero call-site change either way.
 *
 * The old Telemachus fork delivered `v.altitude`/`v.heightFromTerrain` as
 * two INDEPENDENT WebSocket key pushes that could land on different
 * network packets with different latencies, which is why this hook used to
 * pair them by real per-sample arrival timestamp within a `pairWindowMs`
 * tolerance (a raw `.subscribeSamples` call on the looked-up legacy
 * source, bypassing `useDataValue` entirely — no shim exposes per-sample
 * timestamps). The mod's
 * `vessel.flight` Topic is a SINGLE WRAPPER OBJECT capturing both fields in
 * the same tick (`KspHost.BuildFlight` reads `part.vessel.altitude`/
 * `heightFromTerrain` in one pass) — every stream update already IS a
 * pair, so the reconciliation problem this hook was built to solve no
 * longer exists. `pairWindowMs` is gone from the options; nothing ever
 * passed it explicitly (confirmed by grep).
 */
export function useGroundSurveySamples(
  opts: UseGroundSurveyOpts = {},
): SurveyResult {
  const cfg = { ...DEFAULT_OPTS, ...opts };
  const flight = useTelemetry("vessel.flight");
  const bodyRaw = useTelemetry<string>(cfg.sourceId, "v.body");
  const splashedRaw = useTelemetry<boolean>(cfg.sourceId, "v.splashed");
  const predictedLatRaw = useTelemetry<number>(
    cfg.sourceId,
    "land.predictedLat",
  );
  const predictedLonRaw = useTelemetry<number>(
    cfg.sourceId,
    "land.predictedLon",
  );
  const predictedLat =
    typeof predictedLatRaw === "number" && Number.isFinite(predictedLatRaw)
      ? predictedLatRaw
      : null;
  const predictedLon =
    typeof predictedLonRaw === "number" && Number.isFinite(predictedLonRaw)
      ? predictedLonRaw
      : null;

  const stateRef = useRef<InternalState>(freshState());
  const [, bump] = useReducer((x: number) => x + 1, 0);

  // Body change (SOI transition / scene reload) resets the buffer — declared
  // BEFORE the flight-driven effect below so a same-tick body change clears
  // stale samples before the new pair is pushed, matching the original
  // subscription-ordering guarantee.
  const parentBodyName = typeof bodyRaw === "string" ? bodyRaw : null;
  useEffect(() => {
    const s = stateRef.current;
    if (parentBodyName !== s.body) {
      s.body = parentBodyName;
      s.samples = [];
      s.hftWindow = [];
      s.lastRealTerrain = null;
      bump();
    }
  }, [parentBodyName]);

  const isSplashed = splashedRaw === true;
  useEffect(() => {
    stateRef.current.splashed = isSplashed;
  }, [isSplashed]);

  useEffect(() => {
    if (!flight) return;
    const s = stateRef.current;
    const altitude = flight.altitudeAsl;
    const hft = flight.altitudeTerrain;
    const surfaceSpeed = flight.surfaceSpeed;
    if (!Number.isFinite(altitude) || !Number.isFinite(hft)) return;

    s.altitude = altitude;
    s.heightFromTerrain = hft;
    s.surfaceSpeed = Number.isFinite(surfaceSpeed) ? surfaceSpeed : null;

    if (s.splashed) {
      bump();
      return;
    }
    // Above the ceiling — terrain readings sweep across hundreds of km of
    // ground per sample and the verdict goes haywire. Skip; the widget
    // shows an "above ceiling" idle state instead.
    if (hft > cfg.surveyCeilingM) {
      bump();
      return;
    }

    // Median filter the raw hft window — single-sample spikes (water,
    // measurement glitches) shouldn't whip the terrain line around.
    s.hftWindow.push(hft);
    if (s.hftWindow.length > 3) s.hftWindow.shift();
    const filteredHft = median(s.hftWindow);
    const terrain = altitude - filteredHft;

    const isFrozen = hft <= cfg.freezeBelowM;
    const sample: SurveySample = isFrozen
      ? { t: Date.now(), terrain: s.lastRealTerrain ?? terrain, kind: "frozen" }
      : { t: Date.now(), terrain, kind: "real" };
    if (!isFrozen) s.lastRealTerrain = terrain;

    s.samples.push(sample);
    const cutoff = sample.t - cfg.windowMs;
    while (s.samples.length > 0 && s.samples[0].t < cutoff) {
      s.samples.shift();
    }
    bump();
  }, [flight, cfg.surveyCeilingM, cfg.freezeBelowM, cfg.windowMs]);

  const s = stateRef.current;
  const surveyState: SurveyResult["surveyState"] =
    s.heightFromTerrain === null
      ? "idle"
      : s.heightFromTerrain > cfg.surveyCeilingM
        ? "above-ceiling"
        : s.heightFromTerrain > cfg.freezeBelowM
          ? "active"
          : "frozen";
  return {
    samples: s.samples,
    surveyState,
    altitude: s.altitude,
    heightFromTerrain: s.heightFromTerrain,
    surfaceSpeed: s.surfaceSpeed,
    predictedLat,
    predictedLon,
    body: s.body,
  };
}

function median(arr: readonly number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export interface SmoothnessVerdict {
  badge: "A" | "B" | "C" | "F";
  label: string;
  stddev: number;
  peakToTrough: number;
}

/**
 * Verdict bands match the spec — calibrated for typical KSP terrain:
 * Mun maria run ~30 m σ, mid-rough Mun runs ~150 m, Bop / Eeloo / Mün
 * highlands push past 400 m and shouldn't be touched.
 */
export function rateSmoothness(
  samples: readonly SurveySample[],
): SmoothnessVerdict | null {
  // Need a non-trivial window; ignore frozen samples — they're a constant
  // and would artificially deflate σ once descent starts.
  const real = samples.filter((s) => s.kind === "real").map((s) => s.terrain);
  if (real.length < 3) return null;
  const mean = real.reduce((a, b) => a + b, 0) / real.length;
  const variance = real.reduce((a, b) => a + (b - mean) ** 2, 0) / real.length;
  const stddev = Math.sqrt(variance);
  let min = real[0];
  let max = real[0];
  for (const v of real) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const peakToTrough = max - min;
  if (stddev < 50) return { badge: "A", label: "Smooth", stddev, peakToTrough };
  if (stddev < 150) {
    return { badge: "B", label: "Acceptable", stddev, peakToTrough };
  }
  if (stddev < 400) {
    return { badge: "C", label: "Rough", stddev, peakToTrough };
  }
  return { badge: "F", label: "Hazardous", stddev, peakToTrough };
}
