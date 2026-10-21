import {
  act,
  clearActionHandlers,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  catalogEntry,
  experiment,
  MINMUS_STATION,
  reportTopic,
  stationReport,
} from "../test/deployedStations";
// Side-effect import: `renderWidget` looks the widget up by id.
import "./index";

/** Proves DeployedScience runs off the real stream pipeline via `StubTransport`, for the catalog, `game.dlc` and a station's own report topic. */
afterEach(() => {
  clearActionHandlers();
});

describe("DeployedScience: genuinely runs off the stream", () => {
  it("renders a deployed station from the report on its own topic", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });

    renderWidget("deployed-science", {
      instanceId: "ds-stream",
      w: 5,
      h: 9,
      wrapper: fixture.Provider,
    });

    expect(fixture.transport.isSubscribed("trackingStation.catalog")).toBe(
      true,
    );

    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("trackingStation.catalog", {
        entries: [
          catalogEntry({
            vesselId: MINMUS_STATION,
            name: "Minmus Flats Outpost",
          }),
        ],
      });
    });

    // The station's topic is opened only once the catalog names it.
    await waitFor(() =>
      expect(fixture.transport.isSubscribed(reportTopic(MINMUS_STATION))).toBe(
        true,
      ),
    );

    act(() => {
      fixture.emit(
        reportTopic(MINMUS_STATION),
        stationReport({
          stationName: "Minmus Flats Outpost",
          body: "Minmus",
          biome: "Flats",
          // Neither a derived `power` nor a balance arrived, so the pill and the balance line are each unknown.
          power: null,
          powerAvailable: null,
          powerRequired: null,
          experiments: [
            experiment({
              partName: "Barometer",
              experimentId: "surfaceExperimentBarometer",
              scienceCompletedPercentage: 15,
              scienceTransmittedPercentage: 0,
              scienceValue: 4.5,
              scienceLimit: 30,
            }),
          ],
        }),
      );
    });

    await waitFor(() => expect(screen.getByText("Minmus")).toBeTruthy());
    expect(screen.getByText("Barometer")).toBeTruthy();
    expect(screen.getAllByText(/Power unknown/i).length).toBe(2);
    expect(visibleText()).toContain("15 %");
  });
});
