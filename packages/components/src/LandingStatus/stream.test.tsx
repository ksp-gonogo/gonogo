import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LandingStatusComponent } from "./index";

/**
 * The M3 batch-3 stream test-adapter proof for LandingStatus (mirrors
 * `ThermalStatus/stream.test.tsx`, batch 1 / `AtmosphereProfile/stream.test.tsx`,
 * batch 2): genuinely running off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport` — no legacy
 * `DataSource` is registered anywhere in this file.
 *
 * LandingStatus's keys split MAPPED / GAPPED (`map-topic.ts`):
 * - MAPPED: `v.heightFromTerrain` -> raw `vessel.flight.altitudeTerrain`,
 *   `v.verticalSpeed` -> raw `vessel.flight.verticalSpeed`,
 *   `v.atmosphericDensity` -> raw `vessel.flight.atmDensity`.
 * - GAPPED: `v.body` (needs a display-map subtopic), every `land.*` key
 *   (the whole suicide-burn/impact/prediction family — no channel exists
 *   yet), `v.atmosphericTemperature`/`v.externalTemperature` (G-11, not
 *   captured on the wire).
 *
 * `noPrediction` (the gate deciding whether the metrics `Body` or the
 * `EmptyState` renders) is driven entirely by the GAPPED `land.timeToImpact`
 * — so with no legacy source registered here, the widget's own DOM can
 * NEVER surface the 3 mapped `vessel.flight.*` values directly (the whole
 * metric grid, including the altitude/descent/ambient rows those 3 keys
 * feed, stays behind the gapped gate). This is the same "gated behind a
 * GAPPED dependency" shape `AtmosphereProfile` hit in batch 2 (there:
 * `v.body`; here: `land.timeToImpact`).
 *
 * Two proofs, matching that precedent:
 * 1. `verticalSpeed`'s sign is visible even through the gate — it drives
 *    `descending`, which flips the EmptyState's own copy ("No landing in
 *    progress" -> "Waiting for a landing prediction…") without needing the
 *    metric grid to render at all. That's a genuine DOM-visible proof for
 *    one of the three mapped keys.
 * 2. White-box `store.sample()` (mirroring `getStreamSnapshot`'s own call)
 *    for `heightFromTerrain`/`atmDensity`, which have no such DOM escape
 *    hatch while gapped.
 */
afterEach(() => {
  cleanup();
});

describe("LandingStatus — genuinely runs off the stream (M3 batch 3)", () => {
  it("reads heightFromTerrain/verticalSpeed/atmosphericDensity off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.flight"],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "landing-stream" }}>
          <LandingStatusComponent id="landing-stream" w={8} h={10} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — verticalSpeed undefined, so descending is
    // false and the widget shows the non-descending empty copy.
    expect(container.textContent).toContain("No landing in progress");

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.flight")).toBe(true);

    act(() => {
      fixture.emit("vessel.flight", {
        altitudeTerrain: 2800,
        verticalSpeed: -42.5,
        atmDensity: 0.087,
      });
    });

    // Proof 1: verticalSpeed's sign flips the EmptyState copy — visible
    // even though land.timeToImpact (GAPPED) keeps the metric grid hidden.
    await waitFor(() => {
      if (
        !container.textContent?.includes("Waiting for a landing prediction")
      ) {
        throw new Error("stream leg has not propagated verticalSpeed yet");
      }
    });
    // land.* is entirely gapped/legacy with no source here — the metric
    // grid never appears.
    expect(container.textContent).not.toContain("Impact in");

    // Proof 2: sample the SAME topics useDataValue's stream path reads
    // (getStreamSnapshot's own store.sample(topic, store.currentFrame()))
    // for the two mapped fields with no DOM escape hatch of their own.
    const heightFromTerrain = fixture.store.sample<number>(
      "vessel.flight.altitudeTerrain",
      fixture.store.currentFrame(),
    );
    expect(heightFromTerrain?.payload).toBe(2800);
    const atmDensity = fixture.store.sample<number>(
      "vessel.flight.atmDensity",
      fixture.store.currentFrame(),
    );
    expect(atmDensity?.payload).toBe(0.087);
  });
});
