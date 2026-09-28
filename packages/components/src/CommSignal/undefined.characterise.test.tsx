import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/**
 * What CommSignal does when its telemetry reads are absent. The empty state
 * is gated on three reads (connected, strength, control level); the delay is
 * not one of them.
 */

// `ControlState` ordinals: Unknown (11) names a state but collapses to no level.
const CONTROL_STATE_FULL = 4;
const CONTROL_STATE_UNKNOWN = 11;

const teardowns: Array<() => void> = [];

function renderComm() {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "comm-undef" }}>
        <CommSignalComponent config={{}} id="comm-undef" w={6} h={5} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  teardowns.push(rendered.unmount);
  return { fixture, ...rendered };
}

afterEach(() => {
  for (const teardown of teardowns) teardown();
  teardowns.length = 0;
});

describe("CommSignal: what undefined means today", () => {
  it("renders the no-signal empty state and NO readout when nothing has arrived", () => {
    const { container } = renderComm();

    expect(screen.getByText("No signal data")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Signal \d of 4$/)).toBeNull();
    expect(screen.queryByText("Control")).toBeNull();
    expect(screen.queryByText("Delay")).toBeNull();
    expect(screen.queryByText("Signal to KSC")).toBeNull();
    expect(screen.queryByText("No signal")).toBeNull();
    expect(visibleText(container)).toContain("COMMNET");
  });

  it("still reports no signal data when only the delay has arrived", async () => {
    const { fixture } = renderComm();

    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: 1.2 });
    });

    // The delay alone does not lift the empty state.
    await waitFor(() =>
      expect(screen.getByText("No signal data")).toBeTruthy(),
    );
    expect(visibleText()).not.toContain("1s");

    // Proves the delay was in the store all along, not dropped.
    act(() => {
      fixture.emit("comms.link", { connected: true });
    });
    await waitFor(() => expect(visibleText()).toContain("1s"));
  });

  it("draws no lit bars and announces the count as unknown when only connected arrives", async () => {
    const { fixture } = renderComm();

    act(() => {
      fixture.emit("comms.link", { connected: true });
    });

    // "0 of 4" would be a verdict about strength made from no reading of it.
    await waitFor(() =>
      expect(screen.getByLabelText("Signal unknown")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Signal 0 of 4")).toBeNull();
    expect(screen.getByText("Signal to KSC")).toBeTruthy();
    expect(screen.getByText("Signal connected")).toBeTruthy();
    // Headline, Control row and Delay row.
    expect(screen.getAllByText(NULL_DISPLAY).length).toBe(3);
    expect(screen.queryByText("LOS")).toBeNull();
  });

  it("reports no signal data when the control-state NAME resolves but its ordinal does not", async () => {
    const { fixture } = renderComm();

    act(() => {
      fixture.emit("vessel.comms", { controlState: CONTROL_STATE_UNKNOWN });
    });

    // Only the level feeds the gate, so a resolved name alone does not lift it.
    await waitFor(() =>
      expect(screen.getByText("No signal data")).toBeTruthy(),
    );
    expect(screen.queryByText("Unknown")).toBeNull();
  });

  it("collapses a live readout back to the never-arrived empty state on a vessel.comms tombstone", async () => {
    const { fixture } = renderComm();

    act(() => {
      fixture.emit("vessel.comms", {
        signalStrength: 0.9,
        controlState: CONTROL_STATE_FULL,
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy(),
    );

    act(() => {
      fixture.emit("vessel.comms", null);
    });

    // A confirmed "no comms" renders as "nothing has come through yet".
    await waitFor(() =>
      expect(screen.getByText("No signal data")).toBeTruthy(),
    );
    expect(screen.queryByLabelText(/^Signal \d of 4$/)).toBeNull();
  });

  it("falls back to the control state when the record arrived without a signalStrength", async () => {
    const { fixture } = renderComm();

    act(() => {
      // The record exists without a strength field, so the bars come off the control state.
      fixture.emit("vessel.comms", { controlState: CONTROL_STATE_FULL });
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy(),
    );
    expect(screen.getAllByText("Full").length).toBeGreaterThanOrEqual(1);
    expect(visibleText()).not.toContain("%");
  });

  it("reads a genuine zero signalStrength as no strength reading at all", async () => {
    const { fixture } = renderComm();

    act(() => {
      // An observed zero strength is discarded like an absent one.
      fixture.emit("vessel.comms", {
        signalStrength: 0,
        controlState: CONTROL_STATE_FULL,
      });
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy(),
    );
    expect(visibleText()).not.toContain("0 %");
  });

  it("renders the delay placeholder for an absent record, an absent field, and a null field alike", async () => {
    const { fixture } = renderComm();

    act(() => {
      fixture.emit("comms.link", { connected: true });
    });
    await waitFor(() => expect(screen.getByText("Delay")).toBeTruthy());

    // No `comms.delay` record at all.
    const rowsWithNoRecord = screen.getAllByText(NULL_DISPLAY).length;
    expect(rowsWithNoRecord).toBe(3);

    // The record arrives without the field.
    act(() => {
      fixture.emit("comms.delay", {});
    });
    await waitFor(() =>
      expect(screen.getAllByText(NULL_DISPLAY).length).toBe(3),
    );

    // An explicit null (no measurable path) reads the same as nothing arrived.
    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: null });
    });
    await waitFor(() =>
      expect(screen.getAllByText(NULL_DISPLAY).length).toBe(3),
    );
  });
});
