import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import {
  installFixedSizeResizeObserver,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { emitAt, KERBIN, MUN } from "../test/bodyEmits";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TwrComponent } from "./index";

const STANDARD_GRAVITY = 9.80665;

/** Emits a one-tonne `vessel.propulsion` payload whose TWR is exactly `twr`. */
function emitTwr(fixture: ReturnType<typeof setupStreamFixture>, twr: number) {
  const thrust = twr * STANDARD_GRAVITY;
  emitAt(fixture, KERBIN);
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
      // One pixel over the slot's floored width, which the strip clips, so the line reaches the frame's inner edge.
      await waitFor(() => expect(trend.getAttribute("width")).toBe("301"));
    } finally {
      restore();
    }
  });
});

describe("TwrComponent while nothing is firing", () => {
  /** A coasting craft whose stage 1 makes 200 kN at 10 t: 2.04 at Kerbin's surface gravity, 12.3 at the Mun's, which is what the game's own ratio is there. */
  function emitCoasting(fixture: ReturnType<typeof setupStreamFixture>) {
    emitAt(fixture, KERBIN);
    fixture.emit("vessel.propulsion", {
      totalMass: 10,
      dryMass: 0,
      currentThrust: 0,
      availableThrust: 200,
    });
    fixture.emit("vessel.structure", { currentStage: 1 });
    fixture.emit("dv.stages", [
      { stage: 1, thrustActual: 200, startMass: 10, twrActual: 12.27 },
    ]);
  }

  function renderWide(fixture: ReturnType<typeof setupStreamFixture>) {
    return render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "twr-test" }}>
          <TwrComponent config={{}} id="twr-test" w={6} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
  }

  it("draws the next stage's ratio at the body's gravity, the basis the firing figure uses", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWide(fixture);
    act(() => {
      emitCoasting(fixture);
    });
    await waitFor(() => expect(visibleText()).toContain("2.04"));
    expect(visibleText()).not.toContain("12.27");
  });

  it("captions the next stage's figure as that stage at ignition and draws no trend of the live ratio", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderWide(fixture);
    act(() => {
      emitCoasting(fixture);
    });
    await waitFor(() => expect(visibleText()).toContain("Stage 1 at ignition"));
    expect(visibleText()).not.toContain("Current stage");
    expect(screen.queryByLabelText("TWR trend")).toBeNull();
  });
});

describe("TwrComponent frame", () => {
  it("draws the gauge and its trend inside one frame, with no sidebar", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "twr-test" }}>
          <TwrComponent config={{}} id="twr-test" w={4} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      emitTwr(fixture, 1.832);
    });
    const gauge = await screen.findByRole("meter");
    const trend = screen.getByRole("img", { name: "TWR trend" });
    const strip = trend.closest("[data-framed-display-strip]");
    expect(strip).not.toBeNull();
    // The strip's parent is the frame itself, and the gauge sits in that same box.
    expect(strip?.parentElement).toContainElement(gauge);
    expect(document.querySelector("[data-panel-lone-frame]")).not.toBeNull();
  });
});

describe("TwrComponent with thrust reported that no engine can make", () => {
  it("draws the thrust the engines can produce, not the stale reading", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderTwr(fixture);
    act(() => {
      emitAt(fixture, KERBIN);
      fixture.emit("vessel.propulsion", {
        totalMass: 54,
        dryMass: 20,
        currentThrust: 650,
        availableThrust: 0,
      });
    });
    await waitFor(() => expect(visibleText()).toContain("0.00"));
    expect(visibleText()).not.toContain("1.22");
  });
});

describe("TwrComponent at the gravity of the body the craft is at", () => {
  function emitLander(fixture: ReturnType<typeof setupStreamFixture>) {
    fixture.emit("vessel.propulsion", {
      totalMass: 4,
      dryMass: 2,
      currentThrust: 10,
      availableThrust: 10,
    });
  }

  it("reads the same craft about six times higher on the Mun than at Kerbin", async () => {
    const kerbin = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    const first = renderTwr(kerbin);
    act(() => {
      emitAt(kerbin, KERBIN);
      emitLander(kerbin);
    });
    await waitFor(() => expect(visibleText()).toContain("0.25"));
    first.unmount();

    const mun = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderTwr(mun);
    act(() => {
      emitAt(mun, MUN);
      emitLander(mun);
    });
    await waitFor(() => expect(visibleText()).toContain("1.54"));
  });

  it("agrees with the game's own stage ratio at the Mun", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderTwr(fixture);
    act(() => {
      emitAt(fixture, MUN);
      emitLander(fixture);
      fixture.emit("vessel.structure", { currentStage: 1 });
      // What KSP's stage simulation gives at the Mun for 10 kN over 4 t: 10 / (4 * 0.166 * 9.80665).
      fixture.emit("dv.stages", [
        { stage: 1, thrustActual: 10, startMass: 4, twrActual: 1.5357 },
      ]);
    });
    await waitFor(() => expect(visibleText()).toContain("1.54"));
  });

  it("draws a dash, not a figure from Kerbin's gravity, when the catalogue has no entry for the body", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderTwr(fixture);
    act(() => {
      emitAt(fixture, MUN, [KERBIN]);
      emitLander(fixture);
    });
    await waitFor(() => expect(visibleText()).toContain(NULL_DISPLAY));
    expect(visibleText()).not.toContain("0.25");
    expect(screen.queryByText(/no engine data/i)).toBeNull();
  });

  it("draws a dash when the craft's body is known but its gravity is not reported", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    renderTwr(fixture);
    act(() => {
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Active Vessel",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 2,
        launchUt: 0,
      });
      fixture.emit("trackingStation.bodies", {
        bodies: [
          {
            name: "Mun",
            index: 2,
            parentIndex: 1,
            radius: 200000,
            orbit: null,
          },
        ],
      });
      emitLander(fixture);
    });
    await waitFor(() => expect(visibleText()).toContain(NULL_DISPLAY));
  });
});
