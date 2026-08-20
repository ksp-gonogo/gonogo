import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/**
 * Proof for the throttle axis's delayed control-stream viz (Task 4 of the
 * delay-stream design): the ONLY continuous axis wired onto
 * `useControlStream` today is throttle, `vessel.control.throttle` being the
 * only channel `getControlChannel` resolves (`VesselControl` has no pitch/
 * yaw/roll READ fields or `[SitrepControlChannel]` declarations yet, see
 * the follow-on note on `throttleStream` in index.tsx). So this file proves
 * ONE thing: `<ControlDelayStream>` renders once a one-way delay is known,
 * fed by the throttle stream, and renders nothing at (or near) zero delay.
 *
 * Sized to clear `showControlSurface`'s gate (rows>=18, cols>=7), same
 * `CONTROL_SIZE` shape `command-stream.test.tsx` uses, so the real control
 * surface (and the graph inside it) mounts.
 */
const CONTROL_MODE_CONFIG = { controlMode: true };
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
    });

    renderControlNavball("nav-cds-throttle", fixture);

    // No graph before any delay is known.
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
    });

    renderControlNavball("nav-cds-throttle-nodelay", fixture);

    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: 0 });
      fixture.emit("vessel.control", { throttle: 0.4 });
    });

    // Give the coalesce interval a tick to prove this is a genuine
    // steady-state check, not just "hasn't rendered yet".
    //
    // Inside act(), because the interval keeps firing state updates into a
    // mounted component for the whole wait: un-wrapped, this one line produced 24
    // of the tree's ~103 act warnings, the largest single cluster in it. The wait
    // itself is the point of the test and stays.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(
      screen.queryByRole("img", { name: /controls in flight/i }),
    ).toBeNull();
  });
});
