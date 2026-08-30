import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

/**
 * The stream test-adapter proof for AtmosphereProfile: genuinely running off
 * the real `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`: no legacy `DataSource` is registered anywhere in this
 * file, and (unlike the pre-migration version of this test) no read is
 * GAPPED any more:
 *
 * - `v.body` -> the DERIVED `vessel.state.parentBodyName` subtopic, resolved
 *   from `vessel.identity.parentBodyIndex` against a `system.bodies` entry.
 * - `v.altitude` -> the DERIVED `vessel.state.altitudeAsl` subtopic.
 * - `v.atmosphericDensity`/`v.atmosphericTemperature`/`v.externalTemperature`
 *   -> raw fields on the `vessel.flight` Topic.
 *
 * `deriveVesselState`'s `altitudeAsl` is populated ONLY on the "measured"
 * (Loaded) basis: the default `Quality.OnRails` leaves it permanently
 * `null`. The `vessel.orbit` emission below carries `metaOverrides:
 * { quality: Quality.Loaded }` so the derivation actually reads
 * `vessel.flight.altitudeAsl`.
 */
describe("AtmosphereProfile: genuinely runs off the stream (M3 batch 2)", () => {
  it("reads body/altitude/density/temperatures off the real stream pipeline, not legacy", async () => {
    registerStockBodies();
    const fixture = setupStreamFixture({
      // vessel.state's carried-channels gate is parent-channel-scoped
      // (vesselStateChannel.inputs): listed in full even though this test's
      // own reads (useStream/canonical useTelemetry) don't consult the gate,
      // to keep the widget's legacy useDataStreamStatus badge reading "live".
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
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "atmo-stream" }}>
          <AtmosphereProfileComponent id="atmo-stream" w={8} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet: the widget shows its "waiting for body" empty state.
    expect(visibleText(container)).toContain("Waiting for body telemetry...");

    // A real subscription must have happened for this to deliver at all,
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.flight")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.identity")).toBe(true);
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(true);

    act(() => {
      // Loaded quality drives deriveVesselState onto the "measured" basis,
      // which reads altitudeAsl off vessel.flight at viewUt, the OnRails
      // default would leave it permanently null (see doc comment above).
      fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      fixture.emit("vessel.flight", {
        altitudeAsl: 80,
        atmDensity: 1.217,
        atmosphericTemperature: 289,
        externalTemperature: 291,
      });
      fixture.emit("vessel.identity", { parentBodyIndex: 1 });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
    });

    // The body now resolves off the stream, so the pressure curve/live chip
    // render for real, proving every one of the five migrated reads
    // genuinely flows through the real TimelineStore.
    await waitFor(() => {
      expect(visibleText(container)).toContain("1.217 kg/m³");
    });
    expect(container.textContent).not.toContain(
      "Waiting for body telemetry...",
    );
  });
});
