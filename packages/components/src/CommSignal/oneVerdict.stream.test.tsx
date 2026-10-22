import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/** The delay and route rows read the same link verdict as the header: they are drawn only while the link is observed up. */

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "comm-verdict" }}>
        <CommSignalComponent id="comm-verdict" w={8} h={8} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return fixture;
}

function emitPlan(fixture: ReturnType<typeof mount>, connected: boolean) {
  act(() => {
    fixture.emit("comms.link", { connected });
    fixture.emit("comms.commandCentre", {
      id: "ground:KSC",
      displayName: "KSC",
      kind: "GroundStation",
      bodyIndex: 1,
    });
    fixture.emit("vessel.comms", { connected, signalStrength: 0.6 });
    fixture.emit("comms.signal", { strength: 0.6, modelled: false });
    fixture.emit("vessel.identity", {
      vesselId: "v1",
      name: "Active Vessel",
      vesselType: 0,
      situation: 1,
      parentBodyIndex: 1,
      launchUt: 0,
    });
    fixture.emit("comms.path", {
      hops: [
        { from: "Active Vessel", to: "Relay Sat 1", kind: 1 },
        { from: "Relay Sat 1", to: "home", kind: 0 },
      ],
    });
    fixture.emit("comms.delay", { oneWaySeconds: 4 });
  });
}

describe("CommSignal: one verdict for the link, shared with the header", () => {
  it("draws the route and the delay while the link is observed up", async () => {
    const fixture = mount();
    emitPlan(fixture, true);
    await waitFor(() => expect(screen.getByText("Relay Sat 1")).toBeTruthy());
    expect(screen.getByText("Delay")).toBeTruthy();
  });

  it("draws neither while the link reads down, however current the path and delay are", async () => {
    const fixture = mount();
    emitPlan(fixture, false);
    await waitFor(() => expect(visibleText()).toContain("No signal"));
    expect(screen.queryByText("Relay Sat 1")).toBeNull();
    expect(screen.queryByText("Delay")).toBeNull();
  });
});
