import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  ANALYTIC_UNBOUNDED_HORIZON,
  UNBOUNDED_HORIZON,
} from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * A stale orbit with no model is still drawn, as the last orbit there was: the
 * elements wear the held mark, the diagram has no craft on it, and the panel
 * says the orbit is held. Figures that place the craft now (apsis altitudes,
 * countdowns, period) stay null.
 */
describe("CurrentOrbit: a stale orbit with no model", () => {
  it("draws the last orbit held rather than nothing", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-stale" }}>
          <CurrentOrbitComponent id="orbit-stale" w={9} h={18} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.orbit", {
        sma: 682500,
        ecc: 0.00367,
        inc: 0.3,
        argPe: 12.5,
        mu: 3.5316e12,
        // Unbounded reach and no stated shape, so the model declines on the elements themselves.
        horizon: UNBOUNDED_HORIZON,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
      });
    });

    await waitFor(() => expect(visibleText()).toContain("0.3°"));
    expect(heldMark("Inc")).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    const reading = () => fixture.store.sampleReading("vessel.orbit");

    // Both halves of the premise: the stream stopped, and no model answered.
    await waitFor(() => expect(reading().state).toBe("stale"));
    expect(reading().reckoning.status).not.toBe("available");

    // The elements are still drawn, each marked held.
    expect(visibleText()).toContain("0.3°");
    expect(visibleText()).toContain("0.0037");
    expect(heldMark("Inc")).not.toBeNull();
    expect(heldMark("Ecc")).not.toBeNull();

    // Nothing that places the craft now survives the lost link.
    for (const row of ["Ap", "Pe", "T"]) {
      expect(rowText(row), `${row} row`).toBe(NULL_DISPLAY);
    }
    expect(vesselDot(container)).toBeNull();
  });

  it("keeps the orbit on the diagram, with no craft on it, and says so in the header", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-held" }}>
          <CurrentOrbitComponent id="orbit-held" w={9} h={18} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("system.bodies", {
        bodies: [{ name: "Kerbin", index: 1, radius: 600000 }],
      });
      // A loaded craft's elements are osculating, so the model declines under physics while the shape stays drawable.
      fixture.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 682500,
          ecc: 0.00367,
          inc: 0.3,
          lan: 0,
          argPe: 12.5,
          mu: 3.5316e12,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
          meanAnomalyAtEpoch: 0,
          epoch: 10,
        },
        { quality: Quality.Loaded },
      );
    });

    await waitFor(() => expect(vesselDot(container)).not.toBeNull());
    expect(screen.queryByText("STALE")).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    const reading = () => fixture.store.sampleReading("vessel.orbit");
    await waitFor(() => expect(reading().state).toBe("stale"));
    expect(reading().reckoning.status).not.toBe("available");

    expect(screen.getByRole("img", { name: "Orbital diagram" })).toBeVisible();
    expect(vesselDot(container)).toBeNull();
    expect(screen.getByText("STALE")).toBeInTheDocument();
  });
});

/** The craft's dot, the one circle the diagram fills in the accent colour. */
function vesselDot(container: HTMLElement): Element | null {
  return container.querySelector('circle[fill="var(--color-accent-fg)"]');
}

/** The value cell beside a readout label, found through the label's text. */
function rowCell(label: string): Element | null {
  const labelCell = screen.getByText(label, { exact: true });
  return labelCell.nextElementSibling;
}

function rowText(label: string): string {
  return rowCell(label)?.textContent?.trim() ?? "";
}

function heldMark(label: string): Element | null {
  return rowCell(label)?.querySelector("[data-held-mark]") ?? null;
}
