import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import {
  installFixedSizeResizeObserver,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TwrComponent } from "./index";

const STANDARD_GRAVITY = 9.80665;

/** Emits a one-tonne `vessel.propulsion` payload whose TWR is exactly `twr`. */
function emitTwr(fixture: ReturnType<typeof setupStreamFixture>, twr: number) {
  const thrust = twr * STANDARD_GRAVITY;
  fixture.emit("vessel.propulsion", {
    totalMass: 1,
    dryMass: 0,
    currentThrust: thrust,
    availableThrust: thrust,
  });
}

function renderTwr(fixture: ReturnType<typeof setupStreamFixture>) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "twr-test" }}>
        <TwrComponent config={{}} id="twr-test" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

describe("TwrComponent off the stream", () => {
  it("shows the empty state before any telemetry arrives", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTwr(fixture);
    expect(await screen.findByText(/no engine data/i)).toBeInTheDocument();
    expect(fixture.transport.isSubscribed("vessel.propulsion")).toBe(true);
  });

  it("renders TWR rounded to two decimals off the stream", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTwr(fixture);
    act(() => {
      emitTwr(fixture, 1.832);
    });
    await waitFor(() => expect(visibleText()).toContain("1.83"));
  });

  it("draws no figure for a craft reporting no positive mass, rather than dividing by it", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTwr(fixture);
    act(() => {
      emitTwr(fixture, 1.832);
    });
    await waitFor(() => expect(visibleText()).toContain("1.83"));

    // Negative, not zero: zero divides to Infinity, which the headline already refuses.
    act(() => {
      fixture.emit("vessel.propulsion", {
        totalMass: -1,
        dryMass: 0,
        currentThrust: 200,
        availableThrust: 200,
      });
    });
    expect(await screen.findByText(/no engine data/i)).toBeInTheDocument();
    expect(visibleText()).not.toContain("-");
  });

  it("renders the TWR value as the gauge's aria-label so screen readers can read it", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTwr(fixture);
    act(() => {
      emitTwr(fixture, 0.85);
    });
    expect(await screen.findByLabelText("TWR 0.85")).toBeInTheDocument();
  });

  it("draws three coloured zones on the dial (nogo / warning / ok)", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTwr(fixture);
    act(() => {
      emitTwr(fixture, 1.5);
    });
    // One track plus three zones.
    const gauge = await screen.findByLabelText("TWR 1.50");
    await waitFor(() => expect(gauge.querySelectorAll("path")).toHaveLength(4));
  });

  it("sizes the trend line to its slot when the first reading arrives after mount", async () => {
    const restore = installFixedSizeResizeObserver({ width: 300, height: 24 });
    try {
      const fixture = setupStreamFixture({
        pinnedUt: 10,
        suspendFrames: true,
      });
      renderTwr(fixture);
      expect(await screen.findByText(/no engine data/i)).toBeInTheDocument();
      act(() => {
        emitTwr(fixture, 1.832);
      });
      const trend = await screen.findByLabelText("TWR trend");
      await waitFor(() => expect(trend.getAttribute("width")).toBe("300"));
    } finally {
      restore();
    }
  });
});
