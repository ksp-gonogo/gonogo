import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitalAscentComponent } from "./index";

/**
 * The stream test-adapter proof for OrbitalAscent: the widget's own read
 * (`v.body`) genuinely runs off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`: no legacy `DataSource` is
 * registered anywhere in this file, so a value only reaches the widget if it
 * actually streamed.
 *
 * `v.body` is `vessel.identity.parentBodyIndex` named against
 * `system.bodies`. Streaming a body no bundled table carries is what proves the
 * value came off the stream: the widget renders its "No reference data"
 * notice, which it could not do from a legacy fallback that isn't wired here.
 *
 * The two plotted series (`vessel.flight.altitudeAsl` and the horizontal speed
 * computed off `vessel.flight`) are NOT asserted here: this file never emits
 * `vessel.flight`, so both resolve empty. The widget still renders its chrome,
 * which the assertions below confirm.
 */
describe("OrbitalAscent: v.body genuinely runs off the stream (R6)", () => {
  it("resolves the streamed parent-body name off the real pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.flight", "vessel.identity", "system.bodies"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ascent-stream" }}>
          <OrbitalAscentComponent id="ascent-stream" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Chrome renders immediately; nothing has streamed yet so no body notice.
    expect(visibleText(container)).toContain("ORBITAL ASCENT");
    expect(container.textContent).not.toContain("No reference data");

    // A real subscription must have happened for StubTransport (which is
    // subscription-gated) to deliver at all.
    expect(fixture.transport.isSubscribed("system.bodies")).toBe(true);

    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Gargantua",
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
      fixture.emit("vessel.identity", { parentBodyIndex: 1, launchUt: 0 });
    });

    /*
     * The parent body name streams through as "Gargantua".
     * The roster reports a radius for it and no gravitational parameter, so
     * the body resolves and its reference curve does not: the "No reference
     * data" notice.
     */
    await waitFor(() => {
      if (!visibleText(container).includes("No reference data")) {
        throw new Error("streamed body name has not resolved yet");
      }
    });
    expect(visibleText(container)).toContain("Gargantua");
  });
});
