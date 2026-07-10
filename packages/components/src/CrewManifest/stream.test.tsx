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
 * P4a shared-map batch (G-13) un-gapped `v.crew` and `v.crewCapacity`
 * alongside the already-mapped `v.crewCount` — all three now land on the
 * single `vessel.crew` wire channel (`count` / `capacity` / `crew:
 * CrewMember[]`):
 * - MAPPED: `v.crewCount` -> `vessel.crew.count`, `v.crew` ->
 *   `vessel.crew.crew`, `v.crewCapacity` -> `vessel.crew.capacity`.
 * - GAPPED: `v.isEVA` (derived quantity with no named field on any M1/M2
 *   channel yet).
 *
 * With no legacy source registered, the full roster + capacity now render
 * off the stream alone — only the EVA badge stays legacy-gapped, proving
 * the mapped fields genuinely drive the widget's rendering off the real
 * pipeline.
 */
afterEach(() => {
  cleanup();
});

describe("CrewManifest — genuinely runs off the stream (M3 batch 4)", () => {
  it("reads v.crewCount/v.crew/v.crewCapacity off the real stream pipeline, not legacy", async () => {
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
      fixture.emit("vessel.crew", {
        count: 3,
        capacity: 4,
        crew: [
          { name: "Jebediah Kerman" },
          { name: "Bill Kerman" },
          { name: "Bob Kerman" },
        ],
      });
    });

    await waitFor(() => expect(screen.getByText("3 / 4 aboard")).toBeTruthy());
    // The roster now renders straight off the stream — no legacy fallback
    // needed for names or capacity.
    expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument();
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
    expect(screen.getByText("Bob Kerman")).toBeInTheDocument();
  });
});
