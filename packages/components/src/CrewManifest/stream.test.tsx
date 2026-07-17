import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CrewManifestComponent } from "./index";

/**
 * The stream test-adapter proof for CrewManifest (mirrors
 * `ThermalStatus/stream.test.tsx`): genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` — no legacy `DataSource` is registered anywhere in this
 * file.
 *
 * `v.crewCount` / `v.crew` / `v.crewCapacity` all land on the single
 * `vessel.crew` wire channel (`count` / `capacity` / `crew: CrewMember[]`),
 * read here via the canonical one-arg `useTelemetry`. `v.isEVA` rides the
 * derived `vessel.state.isEVA` field (from `vessel.identity.vesselType`); it
 * is not emitted here, so the EVA badge simply stays off.
 *
 * With no legacy source registered, the full roster + capacity render off the
 * stream alone, proving the mapped fields genuinely drive the widget's
 * rendering off the real pipeline.
 */
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
