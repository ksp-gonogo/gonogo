import type { DataKey } from "@ksp-gonogo/core";
import type { Store } from "./storage/Store";
import type { FlightRecord } from "./types";

/**
 * Portable, versioned representation of a `BufferedDataSource`-recorded
 * flight — the shape `BufferedDataSource.exportFlight()` produces and the
 * old flight-history export/download button (still live in `FlightsManager`
 * for legacy, star/graph/chapter-editable flights) downloads as JSON.
 *
 * NOT the mission-recording/replay fixture — that's `ReplayFixture`
 * (`@ksp-gonogo/sitrep-client`), a raw wire-frame capture the new
 * `StreamRecorder`/`ReplaySessionController` produce and consume. This type
 * predates that system and stays scoped to `BufferedDataSource`'s own
 * per-sample export/import, which is unrelated (still Telemachus-fed, not
 * on the new stream).
 *
 * `samples` uses `[t, v]` tuples (not `{ t, v }` objects) to roughly halve
 * the on-disk size of long recordings. Sample `t` values are absolute unix
 * milliseconds (matching the in-store shape).
 */
export interface FlightChapter {
  readonly id: string;
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface FlightFixture {
  /**
   * Format identifier + version. Bump the version when the on-disk shape
   * changes; older readers can refuse rather than mis-parse.
   */
  readonly format: "gonogo-flight-fixture/v1";
  /**
   * Flight metadata — uses the same `FlightRecord` shape the live
   * `BufferedDataSource` produces, so a captured fixture round-trips
   * losslessly through the Store.
   */
  readonly flight: FlightRecord;
  /**
   * Schema entries the export advertises. Doesn't have to enumerate every
   * key in `samples`.
   */
  readonly schema: ReadonlyArray<DataKey>;
  /**
   * Per-key sample timeline. Tuples are `[t, v]` with `t` in unix ms.
   * Tuples MUST be sorted ascending by `t` per key.
   */
  readonly samples: Readonly<
    Record<string, ReadonlyArray<readonly [number, unknown]>>
  >;
  /** Optional named windows, round-tripped from `FlightRecord.chapters`. */
  readonly chapters?: ReadonlyArray<FlightChapter>;
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
  if (v.chapters !== undefined) {
    if (!Array.isArray(v.chapters)) return false;
    for (const c of v.chapters as Array<Partial<FlightChapter>>) {
      if (
        !c ||
        typeof c !== "object" ||
        typeof c.id !== "string" ||
        typeof c.label !== "string" ||
        typeof c.startMs !== "number" ||
        typeof c.endMs !== "number" ||
        c.endMs < c.startMs
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Total span of the fixture in milliseconds (last sample - first sample).
 */
export function fixtureDurationMs(fixture: FlightFixture): number {
  return Math.max(0, fixture.flight.lastSampleAt - fixture.flight.launchedAt);
}

export interface ExportFlightOptions {
  /**
   * Keys to capture into the fixture. The Store doesn't track which keys
   * exist for a flight (samples are bucketed per (flightId, key)) so the
   * caller specifies the set explicitly. Pass the source's full schema
   * for a complete export.
   */
  keys: ReadonlyArray<string>;
  /**
   * Schema entries to embed in the fixture. Defaults to one bare `{ key }`
   * entry per `keys[]` — pass the live source's `schema()` to preserve
   * labels/units/groups for downstream tools.
   */
  schema?: ReadonlyArray<DataKey>;
}

/**
 * Read every sample for `keys` belonging to `flightId` from the store and
 * pack them into a portable `FlightFixture`. Empty key series are dropped
 * from `samples` (rather than carried as `[]`) so a fixture round-tripped
 * through this helper stays compact.
 */
export async function exportFlightToFixture(
  store: Store,
  flightId: string,
  opts: ExportFlightOptions,
): Promise<FlightFixture> {
  const flight = await store.getFlight(flightId);
  if (!flight) throw new Error(`Flight ${flightId} not found in store`);
  // queryRange takes inclusive timestamps; spanning [0, lastSampleAt] picks
  // up everything for the flight without us having to track per-key bounds.
  const tEnd = flight.lastSampleAt;
  const samples: Record<string, [number, unknown][]> = {};
  for (const key of opts.keys) {
    const range = await store.queryRange(flightId, key, 0, tEnd);
    if (range.t.length === 0) continue;
    const tuples: [number, unknown][] = new Array(range.t.length);
    for (let i = 0; i < range.t.length; i++) {
      tuples[i] = [range.t[i], range.v[i]];
    }
    samples[key] = tuples;
  }
  return {
    format: FLIGHT_FIXTURE_FORMAT,
    flight,
    schema: opts.schema ? [...opts.schema] : opts.keys.map((key) => ({ key })),
    samples,
  };
}

/**
 * Write a fixture's flight metadata + every sample tuple into the store.
 * Mirrors the on-disk shape exactly — round-tripping through `export →
 * import` produces an identical fixture (modulo undefined-vs-missing
 * schema metadata).
 *
 * Calls `store.flush()` at the end so `IndexedDbStore`'s batched writes
 * are observable to subsequent reads.
 */
export async function importFixtureToStore(
  store: Store,
  fixture: FlightFixture,
): Promise<void> {
  await store.upsertFlight(fixture.flight);
  for (const [key, series] of Object.entries(fixture.samples)) {
    for (const [t, v] of series) {
      await store.appendSample(fixture.flight.id, key, t, v);
    }
  }
  await store.flush();
}
