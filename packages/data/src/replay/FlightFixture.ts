import type { DataKey } from "@gonogo/core";
import type { FlightRecord } from "../types";

/**
 * Portable, versioned representation of a recorded or synthesized flight.
 *
 * The fixture is the kernel of the replay system: a Store can export a
 * recorded flight to one, a test can hand-build one with `synthesizeFlight`,
 * and a `FlightReplayDataSource` can drive samples back out of it.
 *
 * `samples` uses `[t, v]` tuples (not `{ t, v }` objects) to roughly halve
 * the on-disk size of long recordings — the hot path in a captured 30-min
 * flight is a few hundred thousand samples.
 *
 * Sample `t` values are absolute unix milliseconds (matching the in-store
 * shape). Replay APIs that talk in elapsed time normalise them against
 * `flight.launchedAt`.
 */
export interface FlightFixture {
  /**
   * Format identifier + version. Bump the version when the on-disk shape
   * changes; older readers can refuse rather than mis-parse.
   */
  readonly format: "gonogo-flight-fixture/v1";
  /**
   * Flight metadata — uses the same `FlightRecord` shape that the live
   * BufferedDataSource produces, so a captured fixture round-trips
   * losslessly through the Store.
   */
  readonly flight: FlightRecord;
  /**
   * Schema entries the replay source advertises. Doesn't have to enumerate
   * every key in `samples`, but `useDataSchema` consumers (e.g. the Graph
   * config picker) only see the keys listed here.
   */
  readonly schema: ReadonlyArray<DataKey>;
  /**
   * Per-key sample timeline. Tuples are `[t, v]` with `t` in unix ms.
   * Tuples MUST be sorted ascending by `t` per key — `FlightReplayDataSource`
   * relies on the ordering to advance its cursors in O(1) per emission.
   */
  readonly samples: Readonly<
    Record<string, ReadonlyArray<readonly [number, unknown]>>
  >;
}

export const FLIGHT_FIXTURE_FORMAT = "gonogo-flight-fixture/v1" as const;

/**
 * Narrow type predicate — useful when loading a JSON file at the boundary.
 * Validates the format tag, the flight metadata shape, and that every
 * sample series is an array of length-2 tuples sorted ascending by `t`.
 */
export function isFlightFixture(value: unknown): value is FlightFixture {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.format !== FLIGHT_FIXTURE_FORMAT) return false;
  if (!v.flight || typeof v.flight !== "object") return false;
  const flight = v.flight as Partial<FlightRecord>;
  if (
    typeof flight.id !== "string" ||
    typeof flight.vesselName !== "string" ||
    typeof flight.launchedAt !== "number" ||
    typeof flight.lastSampleAt !== "number" ||
    typeof flight.lastMissionTime !== "number" ||
    typeof flight.sampleCount !== "number"
  ) {
    return false;
  }
  if (!Array.isArray(v.schema)) return false;
  if (!v.samples || typeof v.samples !== "object") return false;
  for (const [, series] of Object.entries(
    v.samples as Record<string, unknown>,
  )) {
    if (!Array.isArray(series)) return false;
    let prevT = -Infinity;
    for (const tuple of series) {
      if (!Array.isArray(tuple) || tuple.length !== 2) return false;
      const t = tuple[0];
      if (typeof t !== "number" || t < prevT) return false;
      prevT = t;
    }
  }
  return true;
}

/**
 * Total span of the fixture in milliseconds (last sample - first sample).
 * Useful for replay seek bars and chapter slicing.
 */
export function fixtureDurationMs(fixture: FlightFixture): number {
  return Math.max(0, fixture.flight.lastSampleAt - fixture.flight.launchedAt);
}
