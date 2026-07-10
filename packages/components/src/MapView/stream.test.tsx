import { DashboardItemContext } from "@gonogo/core";
import { Quality } from "@gonogo/sitrep-sdk";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MapViewComponent } from "./index";

/**
 * The M3 mechanical-tail-batch stream test-adapter proof for MapView —
 * genuinely running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`; no legacy `DataSource` is
 * registered anywhere in this file.
 *
 * MapView's `useDataValue` keys split MAPPED / GAPPED (`map-topic.ts`):
 * - MAPPED: `v.lat`/`v.long` -> raw `vessel.flight.latitude`/`.longitude`,
 *   `v.dynamicPressure`/`v.mach`/`v.surfaceSpeed`/`v.verticalSpeed` -> raw
 *   `vessel.flight.*` fields, `v.altitude` -> the DERIVED
 *   `vessel.state.altitudeAsl` subtopic.
 * - GAPPED: `v.body`, `o.orbitPatches`/`o.maneuverNodes` (trajectory +
 *   maneuver overlays), `t.universalTime`, `land.predictedLat`/
 *   `land.predictedLon`, `a.physicsMode`, `o.encounterExists` (plus
 *   `OrbitalEventChips`'s own `o.encounterBody`/`o.encounterTime`, a
 *   separate shared-component read site). The per-key `TelemetryRow`/
 *   `CoverageRow` readouts and every `scan.*` SCANsat channel are out of
 *   M1/M2/M3 scope — `mapTopic` has no entry for them, so `useDataValue`
 *   falls back to legacy automatically regardless of which dynamic key is
 *   selected.
 *
 * Uses the compact (`!showMap`) mode — a narrow/short widget renders a
 * plain Lat/Lon/Alt text readout instead of the canvas map, so the mapped
 * values are directly DOM-visible without needing a white-box `store.
 * sample()` proof.
 */
afterEach(() => {
  cleanup();
});

describe("MapView — genuinely runs off the stream (M3 mechanical-tail batch)", () => {
  it("reads lat/long/altitude off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      // vessel.identity/system.bodies: vessel.state's carried-channels gate
      // is parent-channel-scoped (M3 vessel-state-extend grew
      // vesselStateChannel.inputs to four) — altitudeAsl needs all four
      // carried even though it doesn't itself read the two new ones.
      carriedChannels: [
        "vessel.orbit",
        "vessel.flight",
        "vessel.identity",
        "system.bodies",
        "vessel.control",
        "vessel.target",
        "vessel.comms",
        "vessel.propulsion",
      ],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mapview-stream" }}>
          <MapViewComponent id="mapview-stream" w={4} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — the compact readout shows the em-dash placeholder.
    expect(container.textContent).toContain("Lat");
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("°");

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.flight")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    act(() => {
      // Loaded quality drives deriveVesselState onto the "measured" basis,
      // which reads altitudeAsl off vessel.flight at viewUt — the OnRails
      // default would leave it permanently null.
      fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      fixture.emit("vessel.flight", {
        latitude: -0.0972,
        longitude: -74.5577,
        altitudeAsl: 80,
        dynamicPressureKPa: 0,
        mach: 0,
        surfaceSpeed: 0,
        verticalSpeed: 0,
      });
    });

    await waitFor(() => {
      expect(container.textContent).toContain("-0.10°");
      expect(container.textContent).toContain("-74.56°");
      expect(container.textContent).toContain("0.1 km");
    });

    // v.body stays gapped/undefined (no legacy source here) — the mapped
    // position/altitude landing doesn't fabricate a body label.
    expect(container.textContent).not.toContain("Kerbin");
  });
});
