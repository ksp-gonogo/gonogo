import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

/**
 * AtmosphereProfile running off the real stream pipeline via `StubTransport`,
 * with no legacy `DataSource` registered: the body resolves through
 * `vessel.identity.parentBodyIndex` against `system.bodies`, and the air
 * readings are raw `vessel.flight` fields.
 */
describe("AtmosphereProfile: genuinely runs off the stream (M3 batch 2)", () => {
  it("reads body/altitude/density/temperatures off the real stream pipeline, not legacy", async () => {
    registerStockBodies();
    const fixture = setupStreamFixture({
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

    // Nothing arrived yet: the "waiting for body" empty state.
    expect(visibleText(container)).toContain("Waiting for body telemetry...");

    // StubTransport.emit is subscription-gated. `vessel.orbit` is subscribed because `vessel.flight`'s reckoner propagates off it.
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

    // The body resolves off the stream, so the curve and chip render through the real TimelineStore.
    await waitFor(() => {
      expect(visibleText(container)).toContain("1.217 kg/m³");
    });
    expect(container.textContent).not.toContain(
      "Waiting for body telemetry...",
    );
  });
});
