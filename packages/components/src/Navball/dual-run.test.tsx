import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import northLevel from "./__fixtures__/north-level.json";
import { NavballComponent } from "./index";

function sasToggleIsPressed(container: HTMLElement): boolean {
  return Array.from(
    container.querySelectorAll('button[aria-pressed="true"]'),
  ).some((button) => button.textContent?.startsWith("SAS"));
}

afterEach(() => {
  clearActionHandlers();
});

describe("Navball: stream render golden (delay=0)", () => {
  it("renders the north-level attitude/control state off the stream", async () => {
    const streamFixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "nav-dual" }}>
          <NavballComponent id="nav-dual" w={8} h={11} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      // The default config reads the root-part frame; the CoM fields keep the payload contract-shaped.
      streamFixture.emit("vessel.attitude", {
        heading: northLevel["n.heading"],
        pitch: northLevel["n.pitch"],
        roll: northLevel["n.roll"],
        headingRootFrame: northLevel["n.heading2"],
        pitchRootFrame: northLevel["n.pitch2"],
        rollRootFrame: northLevel["n.roll2"],
      });
      streamFixture.emit("vessel.control", {
        sas: northLevel["f.sasEnabled"],
        // 0 = StabilityAssist.
        sasMode: 0,
        rcs: northLevel["v.rcsValue"],
        precisionControl: northLevel["f.precisionControl"],
        throttle: northLevel["f.throttle"],
      });
    });

    // At 8x11 there is no control surface, so the pressed SAS toggle is the only observable for the control state.
    await waitFor(() => {
      const attitudeResolved = !visibleText(container).includes(NULL_DISPLAY);
      if (!attitudeResolved || !sasToggleIsPressed(container)) {
        throw new Error("stream leg has not rendered the attitude state yet");
      }
    });
    expect(sasToggleIsPressed(container)).toBe(true);
  });
});
