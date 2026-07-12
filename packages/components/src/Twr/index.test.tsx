import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TwrComponent } from "./index";

/**
 * Twr's stream test: the widget genuinely runs OFF THE STREAM (a
 * real `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline via
 * `StubTransport`) — no legacy `DataSource` is registered anywhere in this
 * file, so a rendered TWR value can only have come from the derived
 * `vessel.state.twr` field.
 *
 * `dv.currentTWR` is MAPPED (`map-topic.ts`) to `vessel.state.twr` — TWR =
 * currentThrust/(totalMass·g), derived client-side off `vessel.propulsion`
 * (`vessel-state.ts`). `carriedChannels` lists all EIGHT of
 * `vessel.state`'s declared inputs even though `deriveTwr` only consults
 * `vessel.propulsion` — the carried-channels gate is parent-channel-scoped,
 * not per-field (see `vesselStateChannel`'s doc comment).
 *
 * The sparkline history (`useDataSeries`) never renders here: a derived topic
 * has no buffered range, so its own shim can't serve a series and there's no
 * legacy source to fall back to — the value read is proven to come entirely off the stream.
 */
afterEach(() => {
  cleanup();
});

const STANDARD_GRAVITY = 9.80665;

const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

// `deriveVesselState` produces NO record until `vessel.orbit` is whole
// (it early-returns `undefined` otherwise), and every derived field — TWR
// included — hangs off that record. A minimal OnRails orbit is emitted
// alongside `vessel.propulsion` so the record exists and `deriveTwr` can run.
const ORBIT = {
  sma: 682500,
  ecc: 0.00367,
  inc: 0.3,
  argPe: 12.5,
  mu: 3.5316e12,
  meanAnomalyAtEpoch: 0,
  epoch: 10,
  referenceBodyIndex: 1,
};

/**
 * Emit the whole-record orbit input plus a `vessel.propulsion` payload whose
 * derived TWR (currentThrust / (totalMass · g), totalMass = 1 tonne) is
 * exactly `twr`.
 */
function emitTwr(fixture: ReturnType<typeof setupStreamFixture>, twr: number) {
  const thrust = twr * STANDARD_GRAVITY;
  fixture.emit("vessel.orbit", ORBIT);
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

describe("TwrComponent — genuinely runs off the stream (R6 Wave 2)", () => {
  it("shows the empty state before any telemetry arrives", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 10,
    });
    renderTwr(fixture);
    expect(await screen.findByText(/no engine data/i)).toBeInTheDocument();
    // A real subscription must have happened for a value to ever arrive —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.propulsion")).toBe(true);
  });

  it("renders TWR rounded to two decimals off the derived stream field", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 10,
    });
    renderTwr(fixture);
    act(() => {
      emitTwr(fixture, 1.832);
    });
    expect(await screen.findByText("1.83")).toBeInTheDocument();
  });

  it("renders the TWR value as the gauge's aria-label so screen readers can read it", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 10,
    });
    renderTwr(fixture);
    act(() => {
      emitTwr(fixture, 0.85);
    });
    expect(await screen.findByLabelText("TWR 0.85")).toBeInTheDocument();
  });

  it("draws three coloured zones on the dial (nogo / warning / ok)", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 10,
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
