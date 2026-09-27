import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/**
 * CommSignal's full readout (strength headline, bars, control label and
 * delay) resolves off the real stream pipeline for a strong direct link.
 */
const CARRIED = ["vessel.comms", "comms.delay", "comms.link"];

describe("CommSignal: full readout off the stream", () => {
  it("resolves strength, bars, control label, and delay off the stream for a strong direct link", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-dual" }}>
          <CommSignalComponent id="comm-dual" w={6} h={5} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      // The wire carries the `ControlState` ordinal: Full is 4.
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.87,
        controlState: 4,
      });
      fixture.emit("comms.delay", { oneWaySeconds: 0.0004 });
      fixture.emit("comms.link", { connected: true });
    });

    expect(fixture.transport.isSubscribed("vessel.comms")).toBe(true);
    expect(fixture.transport.isSubscribed("comms.delay")).toBe(true);

    await waitFor(() => expect(visibleText()).toContain("87 %"));
    expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy();
    expect(screen.getByText("Full")).toBeTruthy();
    expect(visibleText()).toContain("0 ms");
    expect(screen.getByText("Signal to KSC")).toBeTruthy();
    expect(container.textContent).not.toContain(NULL_DISPLAY);
  });
});
