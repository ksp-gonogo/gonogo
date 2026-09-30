import {
  DashboardItemContext,
  getComponent,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

/**
 * LandingStatus running off the stream through a real `StubTransport` pipeline, with no legacy `DataSource` registered, on a real Mun descent: subscription, carried-channel promotion, body resolution and the DOM render end to end.
 * `vessel.orbit` is emitted `{ quality: Quality.Loaded }`, a craft under physics.
 */

const MUN = { index: 3, name: "Mun", radius: 200_000, mu: 6.5138398e10 };

describe("LandingStatus: full-vector solve genuinely runs off the stream", () => {
  // A spec replays its scenario inside one rolling second, so the contribution budgets are reset between tests rather than raised.

  // jsdom lays nothing out, so charts need a told size.
  let restoreResizeObserver: () => void;
  afterEach(() => {
    restoreResizeObserver();
  });
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
    registerStockBodies();
    stream = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderWidget(size?: { w: number; h: number }) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "landing-stream" }}>
          <WidgetContributions Widget={LandingStatusComponent}>
            <LandingStatusComponent
              id="landing-stream"
              w={size?.w ?? 8}
              h={size?.h ?? 10}
            />
          </WidgetContributions>
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  function emitMunDescent() {
    stream.emit("system.bodies", {
      bodies: [
        {
          name: MUN.name,
          index: MUN.index,
          parentIndex: 0,
          radius: MUN.radius,
          orbit: null,
        },
      ],
    });
    stream.emit("vessel.identity", {
      vesselId: "test-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 0,
      parentBodyIndex: MUN.index,
      launchUt: null,
    });
    stream.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: MUN.index,
        sma: 250_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: MUN.mu,
      },
      { quality: Quality.Loaded },
    );
    // h=5km, descending 50 m/s with 540 m/s of mostly horizontal surface speed.
    stream.emit("vessel.flight", {
      latitude: 0,
      longitude: 0,
      altitudeAsl: 0,
      altitudeTerrain: 5000,
      verticalSpeed: -50,
      surfaceSpeed: 540,
      orbitalSpeed: 540,
      atmDensity: 0,
    });
    // aMax = availableThrust / totalMass = 20 m/s^2.
    stream.emit("vessel.propulsion", {
      totalMass: 1,
      dryMass: 0.5,
      currentThrust: 0,
      availableThrust: 20,
    });
  }

  it("renders the Mun descent board off the streamed identity, flight and propulsion", async () => {
    const { container } = renderWidget();

    // Nothing arrived yet: the empty state shows.
    expect(visibleText(container)).toContain("No landing in progress");
    // StubTransport is subscription-gated, so a real subscription must have happened.
    expect(stream.transport.isSubscribed("vessel.flight")).toBe(true);

    act(() => {
      emitMunDescent();
    });

    // The rail is a gauge, so the streamed AGL datum (5000 m) is an `aria-valuenow` on a meter.
    await waitFor(() =>
      expect(
        screen.getByRole("meter", { name: /altitude above terrain/i }),
      ).toHaveAttribute("aria-valuenow", "5000"),
    );
    // The velocity split is a readout; with no terrain patch the cross-section contributes nothing.
    expect(container.textContent).toMatch(/538/);
    // The subtitle names the body off vessel.identity.
    expect(screen.getByText(/mun · vacuum/i)).toBeInTheDocument();
    // Empty state is gone once the descent is streaming.
    expect(container.textContent).not.toContain("No landing in progress");
  });

  // The widget displays the vessel.surface lowest-point height, independently gated from vessel.flight, so the declared datum must be vessel.surface.
  it("badges on the withheld vessel.surface datum, not the live vessel.flight fallback (L2)", async () => {
    // Small size renders the plain AGL readout; the wide rail carries no "AGL" text.
    const { container } = renderWidget({ w: 4, h: 10 });

    // Flight flowing but vessel.surface withheld: the widget falls back to the CoM datum and keeps rendering.
    act(() => {
      emitMunDescent(); // emits vessel.flight, NOT vessel.surface
    });
    await screen.findByText("AGL");

    // The declaration drives alarm attribution: an alarm on the withheld datum has to reach this widget.
    expect(getComponent("landing-status")?.dataRequirements).toContain(
      "vessel.surface",
    );

    // The CoM fallback is not yet surfaced to the operator; the assertions below prove the derivation only.

    // Once vessel.surface arrives the shown AGL switches to the lowest-point datum.
    act(() => {
      stream.emit("vessel.surface", { heightFromTerrain: 4800 });
    });
    await waitFor(() => expect(visibleText(container)).toContain("4.80 km"));
  });

  it("surfaces the round trip in the header, which is what replaced the warnings", async () => {
    // The round trip, the datum under commit and blind timing, must be on screen in the panel header beside the regime.
    renderWidget({ w: 12, h: 16 });
    act(() => {
      emitMunDescent();
      stream.emit("comms.delay", { source: 1, oneWaySeconds: 4 });
    });
    await waitFor(() => expect(screen.getByText(/^RT\b/)).toBeInTheDocument());
  });
});
