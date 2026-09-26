import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import northLevel from "./__fixtures__/north-level.json";
import { NavballComponent } from "./index";

/**
 * Navball's stream render golden. Every read comes off the stream with no
 * legacy fallback: the attitude trio off `vessel.attitude.*`, and SAS/RCS/
 * precision/throttle and the SAS mode off `vessel.control`. This proves the
 * north-level attitude/control state renders correctly off the real stream
 * pipeline.
 */
afterEach(() => {
  clearActionHandlers();
});

describe("Navball: stream render golden (delay=0)", () => {
  it("renders the north-level attitude/control state off the stream", async () => {
    const streamFixture = setupStreamFixture({
      carriedChannels: ["vessel.attitude", "vessel.control"],
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
      // The default config reads the root-part frame (*RootFrame); the base
      // CoM fields are emitted too so the payload matches the contract shape.
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
        // Numeric SasMode enum (0 = StabilityAssist), named off
        // `SAS_MODE_NAMES` for the widget to render.
        sasMode: 0,
        rcs: northLevel["v.rcsValue"],
        precisionControl: northLevel["f.precisionControl"],
        throttle: northLevel["f.throttle"],
      });
    });

    // The SAS mode name resolves only off vessel.control, which is fed purely
    // by the stream here: so its presence proves the stream leg landed (and the attitude readouts have left their NULL_DISPLAY
    // placeholder). The caption is the only observable for it at this size,
    // 8x11 being below the control surface's rows>=18 threshold, so there is no
    // lit mode button to read instead.
    await waitFor(() => {
      const attitudeResolved = !visibleText(container).includes(NULL_DISPLAY);
      if (!attitudeResolved || !visibleText(container).includes("SAS: SAS")) {
        throw new Error("stream leg has not rendered the attitude state yet");
      }
    });
    expect(visibleText(container)).toContain("SAS: SAS");
  });
});
