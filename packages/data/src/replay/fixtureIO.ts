import type { DataKey } from "@ksp-gonogo/core";
import type { Store } from "../storage/Store";
import { FLIGHT_FIXTURE_FORMAT, type FlightFixture } from "./FlightFixture";

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
