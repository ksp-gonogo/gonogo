import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

/**
 * The stream test-adapter proof for AtmosphereProfile (mirrors
 * `ThermalStatus/stream.test.tsx`): genuinely running off the real
 * `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport` — no legacy `DataSource` is registered anywhere in this
 * file.
 *
 * AtmosphereProfile's keys split MAPPED / GAPPED (`map-topic.ts`):
 * - MAPPED: `v.altitude` -> the DERIVED `vessel.state.altitudeAsl`
 *   subtopic (this widget is the FIRST to route through the derived
 *   `vessel.state` channel rather than a raw wire
 *   topic — see `vessel-state.ts`'s `deriveVesselState`). `v.
 *   atmosphericDensity` -> the raw field `vessel.flight.atmDensity`.
 *   `v.atmosphericTemperature`/`v.externalTemperature` (also mapped)
 *   -> the raw fields `vessel.flight.atmosphericTemperature` /
 *   `vessel.flight.externalTemperature` — the same already-carried
 *   `vessel.flight` channel as the density read, so no new
 *   `carriedChannels` entry is needed for this migration.
 * - GAPPED: `v.body` (needs a display-map subtopic — the widget can't
 *   resolve a `BodyDefinition` without it).
 *
 * `deriveVesselState`'s `altitudeAsl` is populated ONLY on the "measured"
 * (Loaded) basis — the default `Quality.OnRails` leaves it permanently
 * `null`. The `vessel.orbit` emission below carries `metaOverrides:
 * { quality: Quality.Loaded }` so the derivation actually reads `vessel.
 * flight.altitudeAsl`; `carriedChannels` lists the RAW inputs
 * (`vessel.orbit`/`vessel.flight`), not `vessel.state` itself — the
 * allowlist gate resolves a derived topic down to its raw wire inputs
 * (`useDataValue.ts`'s own doc comment).
 *
 * Because `v.body` is GAPPED and this file registers no legacy source at
 * all, the widget's own DOM can never visibly surface the mapped altitude/
 * density values here (the whole pressure-curve plot and the live-density
 * chip both gate on a resolved `BodyDefinition` — exercised together with
 * a legacy AUX source for `v.body` in `dual-run.test.tsx`). So this test
 * proves the mapped reads genuinely flow through the real `TimelineStore`
 * by sampling the same two topics `useDataValue`'s stream path reads
 * (`getStreamSnapshot`'s own `store.sample(topic, store.currentFrame())`),
 * and separately proves the GAPPED `v.body` dependency degrades
 * gracefully (the empty state's copy is unchanged by the mapped
 * emissions landing) rather than crashing or fabricating a body.
 */
describe("AtmosphereProfile — genuinely runs off the stream (M3 batch 2)", () => {
  it("reads altitude/atmosphericDensity off the real stream pipeline, not legacy", async () => {
    registerStockBodies();
    const fixture = setupStreamFixture({
      // vessel.identity/system.bodies: vessel.state's carried-channels gate
      // is parent-channel-scoped (vesselStateChannel.inputs grew to four) —
      // altitudeAsl needs all four carried even though it doesn't itself
      // read the two new ones.
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
        <DashboardItemContext.Provider value={{ instanceId: "atmo-stream" }}>
          <AtmosphereProfileComponent id="atmo-stream" w={8} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — v.body (GAPPED, no legacy source here) is
    // undefined, so the widget shows its "waiting for body" empty state.
    expect(container.textContent).toContain("Waiting for body telemetry...");

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.flight")).toBe(true);

    act(() => {
      // Loaded quality drives deriveVesselState onto the "measured" basis,
      // which reads altitudeAsl off vessel.flight at viewUt — the OnRails
      // default would leave it permanently null (see doc comment above).
      fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      fixture.emit("vessel.flight", {
        altitudeAsl: 80,
        atmDensity: 1.217,
        atmosphericTemperature: 289,
        externalTemperature: 291,
      });
    });

    // Sample the SAME four topics useDataValue's stream path reads
    // (getStreamSnapshot's own store.sample(topic, store.currentFrame()))
    // — proves the mapped reads genuinely resolved off the real
    // TimelineStore, not a hardcoded fixture shortcut.
    await waitFor(() => {
      const altitude = fixture.store.sample<number>(
        "vessel.state.altitudeAsl",
        fixture.store.currentFrame(),
      );
      if (altitude?.payload !== 80) {
        throw new Error("vessel.state.altitudeAsl has not resolved yet");
      }
      const density = fixture.store.sample<number>(
        "vessel.flight.atmDensity",
        fixture.store.currentFrame(),
      );
      if (density?.payload !== 1.217) {
        throw new Error("vessel.flight.atmDensity has not resolved yet");
      }
      const airTemp = fixture.store.sample<number>(
        "vessel.flight.atmosphericTemperature",
        fixture.store.currentFrame(),
      );
      if (airTemp?.payload !== 289) {
        throw new Error(
          "vessel.flight.atmosphericTemperature has not resolved yet",
        );
      }
      const skinTemp = fixture.store.sample<number>(
        "vessel.flight.externalTemperature",
        fixture.store.currentFrame(),
      );
      if (skinTemp?.payload !== 291) {
        throw new Error(
          "vessel.flight.externalTemperature has not resolved yet",
        );
      }
    });

    // v.body stays gapped/undefined (no legacy source in this file) —
    // the mapped altitude/density landing doesn't fabricate a body or
    // otherwise change the empty-state copy.
    expect(container.textContent).toContain("Waiting for body telemetry...");
  });
});
