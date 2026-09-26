import {
  act,
  clearActionHandlers,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
// Side-effect import: `renderWidget` looks the widget up by id.
import "./index";

/** Proves DeployedScience runs off the real stream pipeline via `StubTransport`, for both `deployed.bases` and `game.dlc`. */
afterEach(() => {
  clearActionHandlers();
});

describe("DeployedScience: genuinely runs off the stream (M3 science-domain finale)", () => {
  it("renders a deployed cluster grouped by vessel from deployed.bases's flat shape", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["deployed.bases", "game.dlc"],
      pinnedUt: 10,
    });

    renderWidget("deployed-science", {
      instanceId: "ds-stream",
      w: 5,
      h: 9,
      wrapper: fixture.Provider,
    });

    expect(fixture.transport.isSubscribed("deployed.bases")).toBe(true);

    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [
        {
          vesselName: "Minmus Flats Outpost",
          partName: "Barometer",
          body: "Minmus",
          situation: "LANDED",
          biome: "Flats",
          experimentId: "surfaceExperimentBarometer",
          scienceCompletedPercentage: 15,
          scienceTransmittedPercentage: 0,
          scienceValue: 4.5,
          scienceLimit: 30,
          powerState: "NoPower",
          connectionState: "NotConnected",
          deployedOnGround: true,
        },
      ]);
    });

    await waitFor(() => expect(screen.getByText("Minmus")).toBeTruthy());
    expect(screen.getByText("Barometer")).toBeTruthy();
    // Neither a derived `power` nor a balance arrived, so the pill and the balance line are each unknown.
    expect(screen.getAllByText(/Power unknown/i).length).toBe(2);
    expect(visibleText()).toContain("15 %");
  });
});
