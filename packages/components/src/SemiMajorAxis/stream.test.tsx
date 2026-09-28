import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SemiMajorAxisComponent } from "./index";

/**
 * SemiMajorAxis running off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport`, with no legacy `DataSource`
 * registered, so a rendered headline, body suffix or sparkline `<path>` can
 * only have come from the stream.
 */

describe("SemiMajorAxis: genuinely runs off the stream", () => {
  it("reads sma AND the reference-body name off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit", "system.bodies"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sma-stream" }}>
          <SemiMajorAxisComponent id="sma-stream" w={5} h={6} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet: the empty state.
    expect(screen.getByText("No orbit data")).toBeTruthy();

    // StubTransport.emit is subscription-gated, so a real subscription must exist.
    expect(fixture.transport.isSubscribed("vessel.orbit")).toBe(true);

    act(() => {
      // referenceBodyIndex 1 resolves to "Kerbin" against system.bodies.
      fixture.emit("vessel.orbit", { sma: 680000, referenceBodyIndex: 1 });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: 600000,
            orbit: null,
          },
        ],
      });
    });

    await waitFor(() => expect(visibleText()).toContain("680.0 km"));
    // The body suffix streams off the named reference body.
    await waitFor(() =>
      expect(screen.getByText("Semi-major axis · Kerbin")).toBeTruthy(),
    );
  });

  it("the plotted sparkline itself streams off the ClientTimeline", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "sma-spark-stream" }}
        >
          <SemiMajorAxisComponent id="sma-spark-stream" w={5} h={6} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Sparkline draws nothing for fewer than 2 finite values.
    expect(
      container.querySelector("svg[aria-label='SMA trend'] path"),
    ).toBeNull();

    // Three points inside the 300 s window ending at the pinned viewUt=10.
    act(() => {
      fixture.emit("vessel.orbit", { sma: 679_400 }, { validAt: -200 });
      fixture.emit("vessel.orbit", { sma: 679_800 }, { validAt: -100 });
      fixture.emit("vessel.orbit", { sma: 680_000 }, { validAt: 10 });
    });

    await waitFor(() => expect(visibleText()).toContain("680.0 km"));
    await waitFor(() => {
      // The stroke path, not the fill, whose baseline-closing segments would pad the count.
      const path = container.querySelector(
        "svg[aria-label='SMA trend'] path[fill='none']",
      );
      expect(path).not.toBeNull();
      const d = path?.getAttribute("d") ?? "";
      // One M and two L: all three points were plotted, not just the latest.
      expect(d.match(/L/g)?.length).toBe(2);
      // A rising series draws descending y, so order came through too. Extremes are inset by half the stroke so they are not clipped.
      expect(d).toBe("M0.00,27.25 L60.00,9.58 L120.00,0.75");
    });
  });
});
