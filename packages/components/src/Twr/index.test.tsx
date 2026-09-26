import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TwrComponent } from "./index";

/**
 * Twr's stream test: the widget genuinely runs OFF THE STREAM (a
 * real `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`): no legacy `DataSource` is registered anywhere in this
 * file, so a rendered TWR value can only have come from `vessel.propulsion`,
 * as currentThrust/(totalMass·g).
 */
const STANDARD_GRAVITY = 9.80665;

const TWR_CHANNELS = ["vessel.propulsion"];

/**
 * Emit a `vessel.propulsion` payload whose TWR (currentThrust / (totalMass · g),
 * totalMass = 1 tonne) is exactly `twr`.
 */
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

describe("TwrComponent: genuinely runs off the stream (R6 Wave 2)", () => {
  it("shows the empty state before any telemetry arrives", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: TWR_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTwr(fixture);
    expect(await screen.findByText(/no engine data/i)).toBeInTheDocument();
    // A real subscription must have happened for a value to ever arrive,
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.propulsion")).toBe(true);
  });

  it("renders TWR rounded to two decimals off the stream", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: TWR_CHANNELS,
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
      carriedChannels: TWR_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTwr(fixture);
    act(() => {
      emitTwr(fixture, 1.832);
    });
    await waitFor(() => expect(visibleText()).toContain("1.83"));

    /*
     * Negative rather than zero: a zero mass divides to Infinity, which the
     * headline refuses on its own, but a negative one divides to a finite
     * figure that only the positive-mass rule keeps off the gauge.
     */
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
      carriedChannels: TWR_CHANNELS,
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
      carriedChannels: TWR_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTwr(fixture);
    act(() => {
      emitTwr(fixture, 1.5);
    });
    // Wait for the gauge to render the new value, then count the zone arcs
    // (1 track + 3 zones = 4 paths inside the gauge svg).
    const gauge = await screen.findByLabelText("TWR 1.50");
    await waitFor(() => expect(gauge.querySelectorAll("path")).toHaveLength(4));
  });
});
