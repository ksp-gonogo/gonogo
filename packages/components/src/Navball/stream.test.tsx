import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/** Proves attitude and control state reach the widget off the real stream pipeline, sized at 8x4 so the textual readout renders. */
afterEach(() => {
  clearActionHandlers();
});

describe("Navball: genuinely runs off the stream (M3 batch 1)", () => {
  it("reads attitude + control state off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "nav-stream" }}>
          <NavballComponent id="nav-stream" w={8} h={4} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Read off the cell: reading and label swap places between the two presentations.
    expect(screen.getByText("HDG").parentElement?.textContent).toContain(
      NULL_DISPLAY,
    );

    expect(fixture.transport.isSubscribed("vessel.attitude")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.control")).toBe(true);

    act(() => {
      // Distinct values prove the default config reads the root-part frame, not the CoM one.
      fixture.emit("vessel.attitude", {
        heading: 200,
        pitch: 40,
        roll: 30,
        headingRootFrame: 87.4,
        pitchRootFrame: 12,
        rollRootFrame: -5,
      });
      fixture.emit("vessel.control", {
        sas: true,
        // 1 = Prograde.
        sasMode: 1,
        rcs: false,
        precisionControl: true,
        throttle: 0.6,
      });
    });

    await waitFor(() => expect(visibleText()).toContain("87°"));
    expect(visibleText()).toContain("+12°");
    expect(visibleText()).toContain("-5°");
    // The toggle names the held mode rather than a bare ON.
    expect(screen.getByRole("button", { name: "SAS: PRO" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "PRECISION" })).toBeTruthy();
  });
});
