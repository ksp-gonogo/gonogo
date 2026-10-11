import type { DataKey } from "../api/types";
import type { FlightStore } from "./storage/Store";
import type { FlightRecord } from "./types";

/**
 * One named stretch of a recorded flight, as a {@link FlightFixture} carries
 * it.
 *
 * @category Flight recording
 */
export interface FlightChapter {
  /** The chapter's identifier. */
  readonly id: string;
  /** The chapter's name. */
  readonly label: string;
  /** Elapsed ms since the flight began, where the chapter starts. */
  readonly startMs: number;
  /** Elapsed ms since the flight began, where the chapter ends. */
  readonly endMs: number;
}

/**
 * A recorded flight as a portable JSON file: the flight's metadata and every
 * sample, which `importFixtureToStore` loads back.
 *
 * @category Flight recording
 */
export interface FlightFixture {
  /**
   * Format identifier + version. Bump the version when the on-disk shape
   * changes; older readers can refuse rather than mis-parse.
   */
  readonly format: "gonogo-flight-fixture/v1";
  /**
   * Flight metadata: uses the same `FlightRecord` shape the live
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

/**
 * The format tag every `FlightFixture` carries.
 *
 * @category Flight recording
 */
export const FLIGHT_FIXTURE_FORMAT = "gonogo-flight-fixture/v1" as const;

/**
 * Whether `value` is a {@link FlightFixture}: the format tag, the flight's
 * details, and every series an array of `[t, v]` pairs in ascending `t`. For
 * checking a JSON file as it is loaded.
 *
 * @category Flight recording
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
 * How long the fixture runs, in milliseconds, from its first sample to its
 * last.
 *
 * @category Flight recording
 */
export function fixtureDurationMs(fixture: FlightFixture): number {
  return Math.max(0, fixture.flight.lastSampleAt - fixture.flight.launchedAt);
}

/**
 * What `exportFlightToFixture` captures.
 *
 * @category Flight recording
 */
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
   * entry per `keys[]`: pass the live source's `schema()` to preserve
   * labels/units/groups for downstream tools.
   */
  schema?: ReadonlyArray<DataKey>;
}

/**
 * Reads every sample of `keys` for `flightId` from the store into a
 * {@link FlightFixture}. A key with no samples is left out.
 *
 * @category Flight recording
 */
export async function exportFlightToFixture(
  store: FlightStore,
  flightId: string,
  opts: ExportFlightOptions,
): Promise<FlightFixture> {
  const flight = await store.getFlight(flightId);
  if (!flight) throw new Error(`Flight ${flightId} not found in store`);
  // queryRange takes inclusive timestamps; spanning [0, lastSampleAt] picks up everything for the flight without us having to track per-key bounds.
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
 * Writes a fixture's flight and every sample into the store, then flushes it,
 * so the samples can be read straight away. Exporting what was imported gives
 * back the same fixture.
 *
 * @category Flight recording
 */
export async function importFixtureToStore(
  store: FlightStore,
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
