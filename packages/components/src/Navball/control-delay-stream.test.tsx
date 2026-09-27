import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/** Proves the throttle-fed control-delay graph renders once a one-way delay is known, and not at zero delay. */
const CONTROL_MODE_CONFIG = { controlMode: true };
// Large enough to clear the control surface's size gate.
const CONTROL_SIZE = { w: 10, h: 20 };

afterEach(() => {
  clearActionHandlers();
});

function renderControlNavball(instanceId: string, fixture: StreamFixture) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <NavballComponent
          config={CONTROL_MODE_CONFIG}
          id={instanceId}
          w={CONTROL_SIZE.w}
          h={CONTROL_SIZE.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

describe("Navball control-delay stream (throttle)", () => {
  it("shows the control-delay graph once a one-way delay is present, fed by the throttle stream", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control", "comms.delay"],
      pinnedUt: 0,
      suspendFrames: true,
    });

    renderControlNavball("nav-cds-throttle", fixture);

    expect(
      screen.queryByRole("img", { name: /controls in flight/i }),
    ).toBeNull();

    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: 1.6 });
      fixture.emit("vessel.control", { throttle: 0.4 });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: /controls in flight/i }),
      ).toBeInTheDocument(),
    );
  });

  it("renders nothing at (near) zero one-way delay", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control", "comms.delay"],
      pinnedUt: 0,
      suspendFrames: true,
    });

    renderControlNavball("nav-cds-throttle-nodelay", fixture);

    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: 0 });
      fixture.emit("vessel.control", { throttle: 0.4 });
    });

    // Waits past the coalesce interval, inside act() since it keeps updating, so this is a steady state and not "not yet".
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(
      screen.queryByRole("img", { name: /controls in flight/i }),
    ).toBeNull();
  });
});

describe("Navball fly-by-wire delay warning", () => {
  it("marks both delay countdowns as held once the delay reading stops arriving", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.control", "comms.delay"],
      pinnedUt: 0,
      suspendFrames: true,
    });
    const { container } = renderControlNavball("nav-fbw-held-delay", fixture);

    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: 1.6 });
      fixture.emit("vessel.control", { throttle: 0.4 });
    });
    act(() => {
      screen.getByRole("button", { name: "Arm FBW" }).click();
    });
    await waitFor(() =>
      expect(screen.getByText(/High signal delay/)).toBeInTheDocument(),
    );
    // The control: a current delay draws no held mark.
    expect(container.querySelectorAll("[data-held-mark]")).toHaveLength(0);

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    // The header badge and the in-body warning each hand Countdown the delay reading, so both carry Unit's held mark.
    await waitFor(() =>
      expect(
        container.querySelectorAll("[data-held-mark]").length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(screen.getByText(/High signal delay/)).toBeInTheDocument();
  });
});
