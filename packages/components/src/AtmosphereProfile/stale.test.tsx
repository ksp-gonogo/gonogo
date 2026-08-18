import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

/**
 * What AtmosphereProfile does when `vessel.flight` stops being current.
 *
 * The decision: the HUD chip is withheld. Density, air temperature and skin
 * temperature are quantities that move as the craft climbs or dives, and the
 * chip states them undated, in three cramped rows pinned over the plot, where
 * the only possible reading is "this is the air outside right now". A held
 * sea-level density under a craft that has since left the atmosphere is not an
 * old reading, it is a wrong one.
 *
 * The chip already disappears for two innocent reasons, though: nothing has
 * arrived yet, and a confirmed vacuum. So the tests that earn this file are the
 * ones proving the withheld case is DISTINGUISHABLE from those two from outside
 * the component, because a plot that keeps drawing its pressure curve looks
 * entirely healthy while it does it.
 */

const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
];

const NOT_CURRENT = "Atmospheric readings no longer current.";

describe("AtmosphereProfile when the flight reading is not current", () => {
  let fixture: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    clearBodies();
    registerStockBodies();
    fixture = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
    // The chart measures itself before it draws anything, and the live chip is
    // gated on the widget being big enough to carry it.
    vi.stubGlobal(
      "ResizeObserver",
      class FakeResizeObserver {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe(_el: Element) {
          this.cb(
            [
              {
                contentRect: { width: 400, height: 300 },
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    clearBodies();
    vi.unstubAllGlobals();
  });

  function renderWidget() {
    return render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "atmo-stale" }}>
          <AtmosphereProfileComponent config={{}} id="atmo-stale" w={8} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
  }

  /** Kerbin at 5.6 km with air around the craft: a chip with all three rows. */
  function emitInAtmosphere(): void {
    act(() => {
      fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      fixture.emit("vessel.flight", {
        altitudeAsl: 5_600,
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
  }

  /** Drops the link, then runs the frame that re-reads every topic's currency. */
  function loseTheLink(): void {
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
  }

  it("draws the chip while the flight reading is current", async () => {
    // The control. Without it every assertion below also passes on a widget
    // that never draws a chip at all.
    const { container } = renderWidget();
    emitInAtmosphere();

    await waitFor(() => expect(visibleText(container)).toContain("ρ"));
    expect(visibleText(container)).toContain("Air");
    expect(visibleText(container)).toContain("Skin");
    expect(visibleText(container)).not.toContain(NOT_CURRENT);
  });

  it("withholds the chip and SAYS the readings are no longer current", async () => {
    const { container } = renderWidget();
    emitInAtmosphere();
    await waitFor(() => expect(visibleText(container)).toContain("ρ"));

    loseTheLink();

    await waitFor(() => expect(visibleText(container)).toContain(NOT_CURRENT));
    // All three rows go together: they are one statement about one air mass,
    // and holding the temperatures beside a withheld density would read as a
    // partial payload rather than a dropped link.
    expect(visibleText(container)).not.toContain("ρ");
    expect(visibleText(container)).not.toContain("Air");
    expect(visibleText(container)).not.toContain("Skin");
  });

  it("does not present a withheld chip as a vacuum", async () => {
    // The distinction the file exists for. A missing chip is what a craft in
    // vacuum shows, and reaching it from a dropped link would report clear
    // space around a craft that is very possibly on fire.
    const { container } = renderWidget();
    emitInAtmosphere();
    await waitFor(() => expect(visibleText(container)).toContain("ρ"));

    // A confirmed zero: the chip goes, and nothing accuses the link, because
    // nothing is wrong with it.
    act(() => {
      fixture.emit(
        "vessel.flight",
        { altitudeAsl: 5_600, atmDensity: 0 },
        { validAt: 1, seq: 1, deliveredAt: 1 },
      );
    });
    await waitFor(() => expect(visibleText(container)).not.toContain("ρ"));
    expect(visibleText(container)).not.toContain(NOT_CURRENT);

    // The same empty chip from a lost link, which does say so.
    loseTheLink();
    await waitFor(() => expect(visibleText(container)).toContain(NOT_CURRENT));
  });

  it("keeps drawing the pressure curve, so the notice is the only cue", async () => {
    // The curve is a body model, not telemetry: it is still true, and it stays.
    // That is exactly why the notice has to exist, the plot looks live.
    const { container } = renderWidget();
    emitInAtmosphere();
    await waitFor(() => expect(visibleText(container)).toContain("ρ"));
    const curvesBefore = container.querySelectorAll("path").length;

    loseTheLink();

    await waitFor(() => expect(visibleText(container)).toContain(NOT_CURRENT));
    expect(container.querySelectorAll("path").length).toBe(curvesBefore);
  });

  it("says nothing about currency before anything has ever arrived", () => {
    // A cold start is not a dropped link, and conflating them would accuse the
    // link on every first paint.
    const { container } = renderWidget();

    expect(visibleText(container)).toContain("Waiting for body telemetry...");
    expect(visibleText(container)).not.toContain(NOT_CURRENT);
  });
});
