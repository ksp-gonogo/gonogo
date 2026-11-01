import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TrackingStationComponent } from "./index";
import "./vesselOrbitsContribution";

const META = {
  componentId: "tracking-station",
  contributionSlots: ["tracking-station.entities"] as const,
};

describe("TrackingStation: the relay graph before the link's first report", () => {
  it("says it is awaiting the first signal until the link reports, whatever the relay graph has done", () => {
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });

    render(
      <fixture.Provider>
        <WidgetMetaContext.Provider value={META}>
          <ContributionsProvider>
            <TrackingStationComponent config={{ frame: "Kerbin" }} id="sv" />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );

    expect(
      screen.getByText(/Comms network · Awaiting first signal/),
    ).toBeTruthy();

    act(() => {
      fixture.emit("comms.network", {
        nodes: [{ id: "home", displayName: "KSC", kind: 0 }],
        edges: [],
        meta: { source: "game" },
      });
    });
    expect(
      screen.getByText(/Comms network · Awaiting first signal/),
    ).toBeTruthy();

    act(() => {
      fixture.emit("comms.link", { connected: true });
    });
    expect(screen.queryByText(/Awaiting first signal/)).toBeNull();
    expect(screen.getByText(/Comms network from/)).toBeTruthy();
  });
});
