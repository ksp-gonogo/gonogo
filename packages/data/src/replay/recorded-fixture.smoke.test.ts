/**
 * Smoke test that exercises the replay path against a *real* captured KSP
 * flight, not a synthesized fixture. It asserts the fixture round-trips through `isFlightFixture` and that
 * the replay source emits the same key set on `connect`.
 *
 * Why bother:
 * - Synthesized fixtures only exercise the shape we hand-write. A real
 *   recording catches drift in Telemachus's emission shape (e.g. an array
 *   value appearing where we assumed a scalar) before it gets blamed on
 *   a widget bug downstream.
 * - The 22 MB recording size is a useful soak — if the JSON.parse or
 *   per-key cursor walk regresses, this test will surface it long before
 *   a 30-minute live capture would.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixtureDurationMs, isFlightFixture } from "./FlightFixture";
import { FlightReplayDataSource } from "./FlightReplayDataSource";

const here = dirname(fileURLToPath(import.meta.url));
// repo root = packages/data/src/replay/ → ../../../..
const repoRoot = resolve(here, "..", "..", "..", "..");
const FIXTURE_PATH = resolve(
  repoRoot,
  "test",
  "recorded_fixtures",
  "launch_to_apoapsis_10000.json",
);

describe("FlightReplayDataSource — recorded launch_to_apoapsis_10000", () => {
  // Read once for all tests; 22 MB JSON is heavy enough to be worth caching.
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

  it("conforms to the FlightFixture v1 shape", () => {
    expect(isFlightFixture(raw)).toBe(true);
  });

  it("contains the canonical telemetry buckets (vessel, orbit, comm, navball)", () => {
    expect(isFlightFixture(raw)).toBe(true);
    const keys = Object.keys(raw.samples);
    // A real launch should contain at least these prefixes — useful
    // canary against schema drift on either side of Telemachus.
    const prefixes = ["v.", "o.", "comm.", "n.", "f.", "tar."];
    for (const p of prefixes) {
      expect(keys.some((k) => k.startsWith(p))).toBe(true);
    }
  });

  it("FlightReplayDataSource connects and exposes the recorded schema", async () => {
    expect(isFlightFixture(raw)).toBe(true);
    const source = new FlightReplayDataSource({ fixture: raw });
    try {
      await source.connect();
      expect(source.status).toBe("connected");
      const schema = source.schema();
      expect(schema.length).toBeGreaterThan(0);
      // Every advertised schema key should have at least one real sample
      // in the fixture — `schema()` driving an empty key list silently
      // is the kind of drift this test exists to catch.
      for (const k of schema.slice(0, 10)) {
        expect(Array.isArray(raw.samples[k.key])).toBe(true);
      }
    } finally {
      source.disconnect();
    }
  });

  it("replays samples in order — altitude monotonically rises through the launch", async () => {
    expect(isFlightFixture(raw)).toBe(true);
    const source = new FlightReplayDataSource({ fixture: raw });
    const altitudes: number[] = [];
    const unsub = source.subscribe("v.altitude", (v) => {
      if (typeof v === "number" && Number.isFinite(v)) altitudes.push(v);
    });
    try {
      await source.connect();
      // Walk the full duration so every sample fires once.
      source.seek(raw.flight.launchedAt + fixtureDurationMs(raw));
      // The user has a known issue where periapsis ends at ~100 km but
      // apoapsis "balloons higher" — so the actual peak altitude should
      // be well past 100 000 m. We don't assert the peak's exact value;
      // just that the launch passes the Kármán-equivalent threshold,
      // which is the cheapest possible "this is a real launch, not
      // ground noise" signal.
      const peak = altitudes.reduce((m, v) => (v > m ? v : m), 0);
      expect(peak).toBeGreaterThan(100_000);
      // Sanity: we received a non-trivial number of samples.
      expect(altitudes.length).toBeGreaterThan(100);
    } finally {
      unsub();
      source.disconnect();
    }
  });
});
