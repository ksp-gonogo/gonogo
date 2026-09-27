import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import {
  installFixedSizeResizeObserver,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AtmosphereProfileComponent } from "./index";

/**
 * What AtmosphereProfile does when `vessel.flight` stops being current: the
 * HUD chip is withheld, since it states the air outside right now, undated,
 * and a held sea-level density under a craft that left the atmosphere is
 * wrong, not old. The chip also vanishes before first arrival and in vacuum,
 * so these tests prove the withheld case is distinguishable from outside: the
 * pressure line stays on the held altitude and wears the held mark.
 */

const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
];

const PRESSURE_LINE = /pascals @ 6 km/;

function heldMark(container: HTMLElement): Element | null {
  return container.querySelector("text [data-held-mark]");
}

function chartName(container: HTMLElement): string {
  return (
    container.querySelector("svg[role='img']")?.getAttribute("aria-label") ?? ""
  );
}

describe("AtmosphereProfile when the flight reading is not current", () => {
  let restoreResizeObserver: () => void = () => {};
  let fixture: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    clearBodies();
    registerStockBodies();
    fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
    // The chart measures itself before drawing, and the chip is size-gated.
    restoreResizeObserver = installFixedSizeResizeObserver({
      width: 400,
      height: 300,
    });
  });

  afterEach(() => {
    clearBodies();
    restoreResizeObserver();
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

  it("draws the chip and an unmarked pressure line while the reading is current", async () => {
    // The control: without it every assertion below passes on a widget that never draws a chip or line.
    const { container } = renderWidget();
    emitInAtmosphere();

    await waitFor(() => expect(visibleText(container)).toContain("ρ"));
    expect(visibleText(container)).toContain("Air");
    expect(visibleText(container)).toContain("Skin");
    expect(visibleText(container)).toMatch(PRESSURE_LINE);
    expect(heldMark(container)).toBeNull();
    expect(chartName(container)).not.toMatch(PRESSURE_LINE);
  });

  it("withholds the chip and marks the pressure line as held", async () => {
    const { container } = renderWidget();
    emitInAtmosphere();
    await waitFor(() => expect(visibleText(container)).toContain("ρ"));

    loseTheLink();

    await waitFor(() => expect(heldMark(container)).not.toBeNull());
    // All three rows go together, one statement about one air mass.
    expect(visibleText(container)).not.toContain("ρ");
    expect(visibleText(container)).not.toContain("Air");
    expect(visibleText(container)).not.toContain("Skin");
    // The line stays on the last altitude, and a screen reader hears that it is held.
    expect(visibleText(container)).toMatch(PRESSURE_LINE);
    expect(chartName(container)).toMatch(/pascals @ 6 km, .+/);
  });

  it("draws no widget-level sentence about currency, the marked line says it", async () => {
    const { container } = renderWidget();
    emitInAtmosphere();
    await waitFor(() => expect(visibleText(container)).toContain("ρ"));

    loseTheLink();

    await waitFor(() => expect(heldMark(container)).not.toBeNull());
    expect(container.querySelector("[role='status']")).toBeNull();
  });

  it("does not present a withheld chip as a vacuum", async () => {
    // A missing chip from a dropped link must not read as the clear vacuum a craft that may be on fire would show.
    const { container } = renderWidget();
    emitInAtmosphere();
    await waitFor(() => expect(visibleText(container)).toContain("ρ"));

    // A confirmed zero: the chip goes and the line stays unmarked.
    act(() => {
      fixture.emit(
        "vessel.flight",
        { altitudeAsl: 5_600, atmDensity: 0 },
        { validAt: 1, seq: 1, deliveredAt: 1 },
      );
    });
    await waitFor(() => expect(visibleText(container)).not.toContain("ρ"));
    expect(heldMark(container)).toBeNull();

    // The same empty chip from a lost link, which does mark the line.
    loseTheLink();
    await waitFor(() => expect(heldMark(container)).not.toBeNull());
  });

  it("keeps drawing the pressure curve beside the held line", async () => {
    // The curve is a body model, not telemetry, so it stays.
    const { container } = renderWidget();
    emitInAtmosphere();
    await waitFor(() => expect(visibleText(container)).toContain("ρ"));
    const curvesBefore = container.querySelectorAll("path").length;

    loseTheLink();

    await waitFor(() => expect(heldMark(container)).not.toBeNull());
    expect(container.querySelectorAll("path").length).toBe(curvesBefore);
  });

  it("marks nothing before anything has ever arrived", () => {
    // A cold start is not a dropped link, and must not accuse it on first paint.
    const { container } = renderWidget();

    expect(visibleText(container)).toContain("Waiting for body telemetry...");
    expect(heldMark(container)).toBeNull();
  });
});
