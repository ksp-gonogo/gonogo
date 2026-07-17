import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/**
 * CommSignal runs entirely off the stream:
 *  - `comm.connected`      -> `comms.link.connected` (canonical `useTelemetry`)
 *  - `comm.signalStrength` -> `vessel.comms.signalStrength`
 *  - `comm.controlState` / `comm.controlStateName` -> the derived
 *    `vessel.state.commsControlStateOrdinal` / `commsControlStateName` fields
 *    (collapsed from `vessel.comms.controlState`'s `ControlState` enum — see
 *    `vessel-state.ts`), read via `useStream`
 *  - `comm.signalDelay`    -> `comms.delay.oneWaySeconds`
 *
 * No legacy `MockDataSource` is registered — a real
 * `TelemetryProvider`/`TimelineStore` pipeline feeds the widget via
 * `fixture.emit`.
 */

// `deriveVesselState` produces NO record until `vessel.orbit` is whole (it
// early-returns `undefined` otherwise), and the derived commsControlState
// fields hang off that record. A minimal orbit is emitted so the record exists.
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

// `Sitrep.Contract.ControlState` ordinals (vessel-state.ts CONTROL_STATE_NAMES):
// 4 = Full (name "Full", collapsed level 2), 0 = None (name "None", level 0).
const CONTROL_STATE_FULL = 4;
const CONTROL_STATE_NONE = 0;

const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
    carriedChannels: [
      "comms.link",
      "vessel.comms",
      "comms.delay",
      "vessel.state",
    ],
    pinnedUt: 10,
  });
}

function renderComm(fixture: ReturnType<typeof newFixture>) {
  const { unmount } = render(
    <fixture.Provider>
      <CommSignalComponent config={{}} id="comm" />
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

describe("CommSignalComponent", () => {
  it("renders the no-data placeholder until any signal field arrives", () => {
    renderComm(newFixture());
    expect(screen.getByText("No signal data")).toBeInTheDocument();
  });

  it("labels the bars accessibly from signal strength", async () => {
    const fixture = newFixture();
    renderComm(fixture);
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.82,
        controlState: CONTROL_STATE_FULL,
      });
      fixture.emit("vessel.orbit", ORBIT);
    });

    // ceil(0.82 * 4) = 4 lit bars
    await waitFor(() =>
      expect(screen.getByLabelText("Signal 4 of 4")).toBeInTheDocument(),
    );
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("Full")).toBeInTheDocument();
  });

  it("drops to zero bars and shows the control tone as lost when disconnected", async () => {
    const fixture = newFixture();
    renderComm(fixture);
    act(() => {
      fixture.emit("comms.link", { connected: false });
      fixture.emit("vessel.comms", {
        connected: false,
        signalStrength: 0,
        controlState: CONTROL_STATE_NONE,
      });
      fixture.emit("vessel.orbit", ORBIT);
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Signal 0 of 4")).toBeInTheDocument(),
    );
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("formats signal delay in seconds or minutes depending on magnitude", async () => {
    const fixture = newFixture();
    renderComm(fixture);
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.5,
        controlState: CONTROL_STATE_FULL,
      });
      fixture.emit("comms.delay", { oneWaySeconds: 135 }); // 2m 15s
    });
    await waitFor(() => expect(screen.getByText("2m 15s")).toBeInTheDocument());
  });
});
