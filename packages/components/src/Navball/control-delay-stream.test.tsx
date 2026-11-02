import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

const CONTROL_MODE_CONFIG = { controlMode: true };
// Large enough to clear the control surface's size gate.
const CONTROL_SIZE = { w: 10, h: 21 };

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

describe("Navball fly-by-wire delay warning", () => {
  it("marks both delay countdowns as held once the delay reading stops arriving", async () => {
    const fixture = setupStreamFixture({
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
