import { DashboardItemContext } from "@ksp-gonogo/core";
import { Staleness } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/** A craft's name does not go out of date: the route still names the craft by its last known name when that is all there is. */

describe("CommSignal route names the craft through a held identity", () => {
  it("uses the last known name rather than the generic label", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "comm-name" }}>
          <CommSignalComponent id="comm-name" w={8} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("comms.commandCentre", {
        id: "ground:KSC",
        displayName: "KSC",
        kind: "GroundStation",
        bodyIndex: 1,
      });
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.6 });
      fixture.emit("comms.signal", { strength: 0.6, modelled: false });
      fixture.emit(
        "vessel.identity",
        {
          vesselId: "v1",
          name: "Mun Lander R",
          vesselType: 0,
          situation: 1,
          parentBodyIndex: 1,
          launchUt: 0,
        },
        { staleness: Staleness.Held },
      );
      fixture.emit("comms.path", {
        hops: [
          { from: "Mun Lander R", to: "Relay Sat 1", kind: 1 },
          { from: "Relay Sat 1", to: "home", kind: 0 },
        ],
      });
    });
    await waitFor(() => expect(screen.getByText("Relay Sat 1")).toBeTruthy());
    expect(screen.getByText("Mun Lander R")).toBeTruthy();
    expect(screen.queryByText("Vessel")).toBeNull();
  });
});
