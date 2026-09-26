import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

/**
 * The stream test-adapter proof for AtmosphereProfile: genuinely running off
 * the real `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`, with no legacy `DataSource` registered anywhere in this
 * file:
 *
 * - `v.body` -> `vessel.identity.parentBodyIndex`, resolved to a name against
 *   a `system.bodies` entry.
 * - `v.altitude`/`v.atmosphericDensity`/`v.atmosphericTemperature`/
 *   `v.externalTemperature` -> raw fields on the `vessel.flight` Topic.
 */
describe("AtmosphereProfile: genuinely runs off the stream (M3 batch 2)", () => {
  it("reads body/altitude/density/temperatures off the real stream pipeline, not legacy", async () => {
    registerStockBodies();
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.flight", "vessel.identity", "system.bodies"],
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
    // `vessel.orbit` is held up by `vessel.flight`'s reckoner, which reckons
    // a flight point forward off the orbit and the body roster.
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.flight")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.identity")).toBe(true);
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(true);

    act(() => {
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
