import { getDataSource } from "@gonogo/core";
import type { Sample } from "@gonogo/data";
import { useEffect, useReducer, useRef } from "react";

export interface SurveySample {
  /** Unix ms — pair time, max(altSample.t, hftSample.t). */
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
  surveyState: "idle" | "active" | "frozen";
  altitude: number | null;
  heightFromTerrain: number | null;
  surfaceSpeed: number | null;
  predictedLat: number | null;
  predictedLon: number | null;
  body: string | null;
}

export interface UseGroundSurveyOpts {
  sourceId?: string;
  /** Rolling time window for the strip, ms. Default 120 000 (2 min). */
  windowMs?: number;
  /** Below this hft (m) the survey freezes. Default 1000. */
  freezeBelowM?: number;
  /** alt + hft must arrive within this window to count as a pair. Default 200 ms. */
  pairWindowMs?: number;
}

interface InternalState {
  samples: SurveySample[];
  altitude: number | null;
  heightFromTerrain: number | null;
  surfaceSpeed: number | null;
  predictedLat: number | null;
  predictedLon: number | null;
  body: string | null;
  splashed: boolean;
  lastAlt: Sample<number> | null;
  lastHft: Sample<number> | null;
  /** Most recent paired-sample time — guards against re-pushing the same pair. */
  lastPairedT: number;
  /** Last 3 raw heightFromTerrain values — median-filtered before terrain calc. */
  hftWindow: number[];
  /** Most recent real terrain elevation; reused while frozen. */
  lastRealTerrain: number | null;
}

interface MaybeBufferedSource {
  subscribe(key: string, cb: (value: unknown) => void): () => void;
  subscribeSamples?: (key: string, cb: (sample: Sample) => void) => () => void;
}

const DEFAULT_OPTS: Required<UseGroundSurveyOpts> = {
  sourceId: "data",
  windowMs: 120_000,
  freezeBelowM: 1000,
  pairWindowMs: 200,
};

/**
 * Pairs `v.altitude` and `v.heightFromTerrain` via `subscribeSamples` so the
 * (alt, hft) pair we use to compute terrain elevation comes from samples
 * within the configured pair window. Two `useDataValue` hooks would re-render
 * with whatever each key happens to hold at render time, mixing up samples
 * from different ticks and producing a noisy strip.
 */
export function useGroundSurveySamples(
  opts: UseGroundSurveyOpts = {},
): SurveyResult {
  const cfg = { ...DEFAULT_OPTS, ...opts };
  const stateRef = useRef<InternalState>({
    samples: [],
    altitude: null,
    heightFromTerrain: null,
    surfaceSpeed: null,
    predictedLat: null,
    predictedLon: null,
    body: null,
    splashed: false,
    lastAlt: null,
    lastHft: null,
    lastPairedT: 0,
    hftWindow: [],
    lastRealTerrain: null,
  });
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const source = getDataSource(cfg.sourceId) as
      | MaybeBufferedSource
      | undefined;
    if (!source) return;

    const tryEmitPair = () => {
      const s = stateRef.current;
      const a = s.lastAlt;
      const h = s.lastHft;
      if (!a || !h) return;
      if (Math.abs(a.t - h.t) > cfg.pairWindowMs) return;
      if (s.splashed) return;
      const t = a.t > h.t ? a.t : h.t;
      if (t <= s.lastPairedT) return;

      // Median filter the raw hft window — single-sample spikes (water,
      // measurement glitches) shouldn't whip the terrain line around.
      s.hftWindow.push(h.v);
      if (s.hftWindow.length > 3) s.hftWindow.shift();
      const filteredHft = median(s.hftWindow);
      const terrain = a.v - filteredHft;

      const isFrozen = h.v <= cfg.freezeBelowM;
      const sample: SurveySample = isFrozen
        ? { t, terrain: s.lastRealTerrain ?? terrain, kind: "frozen" }
        : { t, terrain, kind: "real" };
      if (!isFrozen) s.lastRealTerrain = terrain;

      s.samples.push(sample);
      s.lastPairedT = t;
      const cutoff = t - cfg.windowMs;
      while (s.samples.length > 0 && s.samples[0].t < cutoff) {
        s.samples.shift();
      }
      bump();
    };

    const unsubAlt = source.subscribeSamples
      ? source.subscribeSamples("v.altitude", (sample) => {
          if (typeof sample.v !== "number" || !Number.isFinite(sample.v)) {
            return;
          }
          stateRef.current.lastAlt = { t: sample.t, v: sample.v };
          stateRef.current.altitude = sample.v;
          tryEmitPair();
        })
      : source.subscribe("v.altitude", (value) => {
          // Fallback for non-buffered sources (tests). Use Date.now() as a
          // stand-in timestamp; pair window is generous enough that two
          // back-to-back values from the same source still pair.
          if (typeof value !== "number" || !Number.isFinite(value)) return;
          stateRef.current.lastAlt = { t: Date.now(), v: value };
          stateRef.current.altitude = value;
          tryEmitPair();
        });

    const unsubHft = source.subscribeSamples
      ? source.subscribeSamples("v.heightFromTerrain", (sample) => {
          if (typeof sample.v !== "number" || !Number.isFinite(sample.v)) {
            return;
          }
          stateRef.current.lastHft = { t: sample.t, v: sample.v };
          stateRef.current.heightFromTerrain = sample.v;
          bump();
          tryEmitPair();
        })
      : source.subscribe("v.heightFromTerrain", (value) => {
          if (typeof value !== "number" || !Number.isFinite(value)) return;
          stateRef.current.lastHft = { t: Date.now(), v: value };
          stateRef.current.heightFromTerrain = value;
          bump();
          tryEmitPair();
        });

    const unsubSpeed = source.subscribe("v.surfaceSpeed", (value) => {
      stateRef.current.surfaceSpeed =
        typeof value === "number" && Number.isFinite(value) ? value : null;
      bump();
    });
    const unsubLat = source.subscribe("land.predictedLat", (value) => {
      stateRef.current.predictedLat =
        typeof value === "number" && Number.isFinite(value) ? value : null;
      bump();
    });
    const unsubLon = source.subscribe("land.predictedLon", (value) => {
      stateRef.current.predictedLon =
        typeof value === "number" && Number.isFinite(value) ? value : null;
      bump();
    });
    const unsubBody = source.subscribe("v.body", (value) => {
      const s = stateRef.current;
      const b = typeof value === "string" && value.length > 0 ? value : null;
      if (b !== s.body) {
        // SOI transition / scene reload — terrain elevations from the old
        // body are meaningless on the new one.
        s.body = b;
        s.samples = [];
        s.hftWindow = [];
        s.lastRealTerrain = null;
        s.lastPairedT = 0;
        bump();
      }
    });
    const unsubSplashed = source.subscribe("v.splashed", (value) => {
      stateRef.current.splashed = value === true;
    });

    return () => {
      unsubAlt();
      unsubHft();
      unsubSpeed();
      unsubLat();
      unsubLon();
      unsubBody();
      unsubSplashed();
    };
  }, [cfg.sourceId, cfg.windowMs, cfg.freezeBelowM, cfg.pairWindowMs]);

  const s = stateRef.current;
  const surveyState: SurveyResult["surveyState"] =
    s.heightFromTerrain === null
      ? "idle"
      : s.heightFromTerrain > cfg.freezeBelowM
        ? "active"
        : "frozen";
  return {
    samples: s.samples,
    surveyState,
    altitude: s.altitude,
    heightFromTerrain: s.heightFromTerrain,
    surfaceSpeed: s.surfaceSpeed,
    predictedLat: s.predictedLat,
    predictedLon: s.predictedLon,
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
