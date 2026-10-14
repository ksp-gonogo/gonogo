import {
  DashboardItemContext,
  getComponent,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { widgetDeclaredTopics } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

/**
 * LandingStatus running off the stream through a real `StubTransport` pipeline, with no `DataSource` registered, on a real Mun descent: subscription, carried-channel promotion, body resolution and the DOM render end to end.
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
    expect(widgetDeclaredTopics(getComponent("landing-status"))).toContain(
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

  it("leaves the round trip out when delay is switched off, rather than writing a zero", async () => {
    renderWidget({ w: 12, h: 16 });
    act(() => {
      emitMunDescent();
      stream.emit("comms.delay", { source: 0, oneWaySeconds: 0 });
    });
    await screen.findByText(/Muna|Mun/);
    await act(async () => {});
    expect(screen.queryByText(/^RT\b/)).toBeNull();
  });

  it("writes a round trip just above zero in milliseconds", async () => {
    renderWidget({ w: 12, h: 16 });
    act(() => {
      emitMunDescent();
      stream.emit("comms.delay", { source: 1, oneWaySeconds: 0.0016 });
    });
    const rt = await screen.findByText(/^RT\b/);
    expect(rt.textContent).toMatch(/RT\s*3\s*ms/);
  });

  it("keeps the row with a dash for a craft with no path", async () => {
    renderWidget({ w: 12, h: 16 });
    act(() => {
      emitMunDescent();
      stream.emit("comms.delay", { source: 0, oneWaySeconds: null });
    });
    const rt = await screen.findByText(/^RT\b/);
    expect(rt.textContent).toContain("\u2014");
  });

  describe("the end of a flight in a crash", () => {
    const crash = {
      ut: 2900,
      vesselId: "test-vessel",
      vesselName: "Muna 1",
      vesselType: "Probe",
      body: "Mun",
      eventKind: "Crash",
      what: "Mun",
      situation: "FLYING",
      latitude: -0.02,
      longitude: 118.84,
      altitude: 1.4,
      partsLost: [{ partName: "probeCoreOcto2" }, { partName: "fuelTank" }],
      kerbalsKilled: [],
      crewAboard: [],
      flightStats: {
        highestAltitude: 6000,
        highestSpeedOverLand: 84,
        highestGee: 3,
        groundDistance: 0,
      },
    };

    it("says the vessel crashed, where and what was lost, instead of falling back to no landing in progress", async () => {
      renderWidget({ w: 12, h: 16 });
      act(() => {
        stream.emit("crash.hasRecent", { recent: true });
        stream.emit("crash.lastCrash", crash);
      });
      const text = () => visibleText(document.body);
      await waitFor(() => expect(text()).toContain("CRASHED"));
      expect(text()).toContain("Muna 1");
      expect(text()).toContain("Mun");
      expect(text()).toContain("2 parts lost");
      expect(text()).not.toContain("No landing in progress");
    });

    it("keeps every row above the touchdown plots and the plots' own headings as they were when the crash arrives, so the plots keep their size and place", async () => {
      const { container } = renderWidget({ w: 16, h: 24 });
      act(() => {
        emitMunDescent();
      });
      const grid = () =>
        container.querySelector<HTMLElement>("[data-plot-columns]");
      await waitFor(() => expect(grid()).not.toBeNull());
      /*
       * What stands above the plots in document order: a row more there takes
       * room from the plots, which are sized to what is left of the tile.
       */
      const rowsAbove = () => {
        const above: string[] = [];
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT,
        );
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const parent = n.parentElement;
          if (!parent || !n.textContent?.trim()) continue;
          const g = grid();
          if (
            g &&
            (g.compareDocumentPosition(parent) &
              Node.DOCUMENT_POSITION_PRECEDING) !==
              0 &&
            !parent.contains(g)
          ) {
            above.push(
              parent.tagName + ":" + parent.getAttribute("data-tooltip"),
            );
          }
        }
        return above.length;
      };
      const headings = () =>
        Array.from(grid()?.children ?? []).map(
          (slot) => (slot.firstElementChild as HTMLElement).style.minHeight,
        );
      const rowsBefore = rowsAbove();
      const headingsBefore = headings();
      expect(headingsBefore).not.toContain("");

      act(() => {
        stream.emit("crash.hasRecent", { recent: true });
        stream.emit("crash.lastCrash", {
          ...crash,
          ut: 10,
          vesselId: "test-vessel",
        });
      });
      await waitFor(() => expect(visibleText(container)).toContain("CRASHED"));
      expect(visibleText(container)).toContain("Muna 1");

      expect(rowsAbove()).toBe(rowsBefore);
      expect(headings()).toEqual(headingsBefore);
    });

    it("leaves a crash from an earlier flight out of it", async () => {
      renderWidget({ w: 12, h: 16 });
      act(() => {
        stream.emit("crash.hasRecent", { recent: false });
        stream.emit("crash.lastCrash", crash);
      });
      await screen.findByText("No landing in progress");
      expect(visibleText(document.body)).not.toContain("CRASHED");
    });
  });
});
