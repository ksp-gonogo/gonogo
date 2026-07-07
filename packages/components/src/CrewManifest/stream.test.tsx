import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CrewManifestComponent } from "./index";

/**
 * The M3 batch-4 stream test-adapter proof for CrewManifest (mirrors
 * `ThermalStatus/stream.test.tsx`, batch 1): genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` — no legacy `DataSource` is registered anywhere in this
 * file.
 *
 * CrewManifest's keys split MAPPED / GAPPED (`map-topic.ts`):
 * - MAPPED: `v.crewCount` -> `vessel.crew.count` (the raw `vessel.crew`
 *   channel's only field).
 * - GAPPED: `v.crew` (no roster channel — G-13), `v.crewCapacity` (same
 *   G-13 note: "count-only lands in vessel.crew.count"), `v.isEVA`
 *   (derived quantity with no named field on any M1/M2 channel yet).
 *
 * With no legacy source registered, `known` (the gate deciding whether the
 * "waiting for telemetry" empty state renders) becomes true the instant
 * `crewCount` arrives off the stream alone — the roster names and EVA
 * badge stay legacy-gapped ("names unavailable" copy) since nothing feeds
 * them here, proving the mapped count genuinely drives the widget's own
 * gating logic off the real pipeline.
 */
afterEach(() => {
  cleanup();
});

describe("CrewManifest — genuinely runs off the stream (M3 batch 4)", () => {
  it("reads v.crewCount off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.crew"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "crew-stream" }}>
          <CrewManifestComponent id="crew-stream" w={6} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — known is false, so the waiting placeholder shows.
    expect(screen.getByText(/Waiting for telemetry/i)).toBeInTheDocument();

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.crew")).toBe(true);

    act(() => {
      fixture.emit("vessel.crew", { count: 3 });
    });

    await waitFor(() => expect(screen.getByText("3 aboard")).toBeTruthy());
    // v.crew (names) is a declared gap with no legacy source here — the
    // widget falls to its "names unavailable" copy rather than a fabricated
    // roster.
    expect(screen.getByText(/names unavailable/i)).toBeInTheDocument();
  });
});
