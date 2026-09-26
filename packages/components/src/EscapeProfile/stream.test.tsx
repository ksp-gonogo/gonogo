import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { EscapeProfileComponent } from "./index";

/**
 * EscapeProfile's stream proof.
 *
 * `v.body` is `vessel.identity.parentBodyIndex` resolved against
 * `system.bodies`. This test runs the widget OFF THE STREAM, a real
 * `TelemetryProvider`/`TimelineStore` pipeline, NO legacy `"data"` source, and
 * proves the streamed body name actually reaches the widget: emitting
 * `vessel.identity` + `system.bodies` for a body with no gravitational
 * parameter surfaces the widget's "No reference data" Notice with that exact
 * name. If the read had silently fallen back to a (nonexistent) legacy source,
 * the body would stay `undefined` and no Notice would render.
 *
 * The plot's trace (`vessel.flight.altitudeAsl`/`orbitalSpeed` via
 * `GraphView`) is not emitted here, so this asserts on the title + body-driven
 * Notice only.
 */
const ESCAPE_PROFILE_CHANNELS = [
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
] as const;

describe("EscapeProfile: reads v.body off the stream (R6)", () => {
  it("surfaces the streamed body name in the no-reference-data notice, with no legacy source", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ESCAPE_PROFILE_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "escape-stream" }}>
          <EscapeProfileComponent id="escape-stream" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // The roster reports a radius for "Proxima" and no gravitational parameter,
    // so a resolved streamed name drives the widget's no-reference-data Notice:
    // an observable proof the value streamed.
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Proxima",
            index: 3,
            parentIndex: 0,
            radius: 700_000,
            orbit: null,
          },
        ],
      });
      fixture.emit("vessel.identity", { parentBodyIndex: 3 });
    });

    await waitFor(() => {
      if (!visibleText(container).includes("No reference data")) {
        throw new Error("streamed body name has not reached the widget yet");
      }
    });

    expect(visibleText(container)).toContain("ESCAPE PROFILE");
    expect(visibleText(container)).toContain("No reference data for Proxima");
  });
});
