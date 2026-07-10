import type { DataKey } from "@ksp-gonogo/core";
import { FLIGHT_FIXTURE_FORMAT, type FlightFixture } from "./FlightFixture";

export interface SynthesizeFlightOptions {
  vesselName: string;
  /**
   * Sample tuples per key. Each tuple is `[t, v]`. By default `t` is
   * interpreted as **elapsed milliseconds since launch** — the helper
   * shifts everything by `launchedAt` so tests don't have to think in
   * unix timestamps. Pass `absolute: true` to use raw unix-ms `t` values.
   */
  samples: Readonly<Record<string, ReadonlyArray<readonly [number, unknown]>>>;
  /** Defaults to `Date.now()` so tests don't accidentally produce identical IDs. */
  launchedAt?: number;
  /** Defaults to a UUID-shaped string. */
  id?: string;
  /** Stamped into the fixture for revert-detection — defaults to 0. */
  lastMissionTime?: number;
  /** When true, sample `t` values are absolute unix ms (default false → relative). */
  absolute?: boolean;
  /** Schema entries to embed. Defaults to bare `{ key }` per sample-keys. */
  schema?: ReadonlyArray<DataKey>;
}

/**
 * Build a `FlightFixture` in memory for tests. The default mode treats
 * sample `t` values as **elapsed milliseconds since launch** — typical
 * usage:
 *
 * ```ts
 * const fixture = synthesizeFlight({
 *   vesselName: "Test Ascent",
 *   samples: {
 *     "v.altitude": [[0, 0], [5_000, 100], [10_000, 1_000]],
 *     "v.body": [[0, "Kerbin"]],
 *   },
 * });
 * ```
 *
 * The helper computes `launchedAt`, `lastSampleAt`, and `sampleCount`
 * automatically. Pass `absolute: true` if you've already got real-world
 * timestamps (e.g. derived from a captured fixture).
 */
export function synthesizeFlight(opts: SynthesizeFlightOptions): FlightFixture {
  const launchedAt = opts.launchedAt ?? Date.now();
  const absolute = opts.absolute ?? false;
  const offset = absolute ? 0 : launchedAt;

  let lastSampleAt = launchedAt;
  let sampleCount = 0;
  const samples: Record<string, [number, unknown][]> = {};

  for (const [key, series] of Object.entries(opts.samples)) {
    const shifted: [number, unknown][] = new Array(series.length);
    for (let i = 0; i < series.length; i++) {
      const [t, v] = series[i];
      const absT = t + offset;
      shifted[i] = [absT, v];
      if (absT > lastSampleAt) lastSampleAt = absT;
    }
    if (shifted.length > 0) {
      samples[key] = shifted;
      sampleCount += shifted.length;
    }
  }

  return {
    format: FLIGHT_FIXTURE_FORMAT,
    flight: {
      id:
        opts.id ??
        `synth-${launchedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      vesselName: opts.vesselName,
      launchedAt,
      lastSampleAt,
      lastMissionTime: opts.lastMissionTime ?? 0,
      sampleCount,
    },
    schema: opts.schema
      ? [...opts.schema]
      : Object.keys(opts.samples).map((key) => ({ key })),
    samples,
  };
}
