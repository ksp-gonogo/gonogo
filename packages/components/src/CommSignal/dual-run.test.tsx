import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/**
 * CommSignal's full readout off the real stream pipeline
 * (`TelemetryProvider` + `StubTransport`), with no legacy `DataSource`: the
 * strength headline, bars, control label (`vessel.comms.controlState`
 * collapsed to a level and named) and the formatted delay
 * (`comms.delay.oneWaySeconds`) all resolve for the same signal state the
 * `strong-direct-ksc` fixture depicts.
 */
// `comms.link` carries the connectivity verdict the caption asserts a signal on.
const CARRIED = ["vessel.comms", "comms.delay", "comms.link"];

describe("CommSignal: full readout off the stream (R6 Wave 1)", () => {
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
      // `controlState` on the wire is the rich `ControlState` enum ordinal
      // (Full = 4); the SDK collapses it to the widget's level (2) and resolves
      // the "Full" name string.
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.87,
        controlState: 4,
      });
      fixture.emit("comms.delay", { oneWaySeconds: 0.0004 });
      fixture.emit("comms.link", { connected: true });
    });

    // A real subscription must have happened for StubTransport (subscription-
    // gated) to deliver at all.
    expect(fixture.transport.isSubscribed("vessel.comms")).toBe(true);
    expect(fixture.transport.isSubscribed("comms.delay")).toBe(true);

    // ceil(0.87 * 4) = 4 lit bars; headline reads the percentage.
    await waitFor(() => expect(visibleText()).toContain("87 %"));
    expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy();
    // Control label + formatted delay both come off the stream now.
    expect(screen.getByText("Full")).toBeTruthy();
    expect(visibleText()).toContain("0 ms");
    expect(screen.getByText("Signal to KSC")).toBeTruthy();
    // No stray NULL_DISPLAY placeholder: every field resolved.
    expect(container.textContent).not.toContain(NULL_DISPLAY);
  });
});
