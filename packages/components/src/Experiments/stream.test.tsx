import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ExperimentsComponent } from "./index";

/**
 * Experiments off the real stream pipeline for `science.lab`,
 * `science.instruments` (in its `InstrumentEntry` wire shape) and
 * `science.experiments`. The recorded lab is operational but idle, a valid
 * steady state.
 */
// Unmounted before the registry clears, so the clear never updates a mounted tree outside act().
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

describe("Experiments: genuinely runs off the stream", () => {
  it("renders the idle-but-operational lab from science.lab and an instrument from science.instruments", async () => {
    const fixture = setupStreamFixture({
      suspendFrames: true,
      pinnedUt: 10,
    });

    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "so-stream" }}>
          <ExperimentsComponent id="so-stream" w={6} h={7} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);

    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [
        {
          partId: "77",
          partName: "Mystery Goo™ Containment Unit",
          experimentId: "mysteryGoo",
          title: "Mystery Goo Observation",
          deployed: false,
          inoperable: false,
          rerunnable: false,
          resettable: false,
          dataIsCollectable: true,
        },
      ]);
      fixture.emit("science.lab", [
        {
          partName: "Mobile Processing Lab MPL-LG-2",
          dataStored: 0,
          dataStorage: 750,
          storedScience: 0,
          processingData: false,
          statusText: "Operational",
          scientistCount: 2,
          scienceRate: 0,
          isOperational: true,
        },
      ]);
    });

    expect(fixture.transport.isSubscribed("science.lab")).toBe(true);
    expect(fixture.transport.isSubscribed("science.instruments")).toBe(true);

    await waitFor(() =>
      expect(visibleText()).toContain("Mobile Processing Lab MPL-LG-2"),
    );
    expect(screen.getByText("OPERATIONAL")).toBeTruthy();
    expect(visibleText()).toContain("2 scientists");
    expect(visibleText()).toContain("0/750 data");
    expect(screen.queryByText("PROCESSING")).not.toBeInTheDocument();

    expect(screen.getByText("Mystery Goo™ Containment Unit")).toBeTruthy();
    expect(screen.getByText("Mystery Goo Observation")).toBeTruthy();
    expect(screen.getByText("DATA")).toBeTruthy();
  });
});

describe("Experiments: instruments whose reusability the wire leaves unknown", () => {
  const stayputnik = (experimentId: string, title: string | null) => ({
    partId: "1475388156",
    partName: "Probodobodyne Stayputnik",
    experimentId,
    title,
    deployed: false,
    inoperable: false,
    rerunnable: null,
    resettable: null,
    dataIsCollectable: false,
  });

  it("lists experiments under their part named once, by their own title or id, and none as one-shot", async () => {
    const fixture = setupStreamFixture({ suspendFrames: true, pinnedUt: 10 });
    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "so-unknown-rerun" }}
        >
          <ExperimentsComponent id="so-unknown-rerun" w={6} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);

    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [
        stayputnik("seismicScan", "Seismic Scan"),
        stayputnik("liteScan", null),
        stayputnik("temperatureScan", "Temperature Scan"),
      ]);
    });

    await waitFor(() =>
      expect(screen.getByText("Seismic Scan")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Probodobodyne Stayputnik")).toHaveLength(1);
    expect(screen.getByText("liteScan")).toBeInTheDocument();
    expect(screen.getByText("Temperature Scan")).toBeInTheDocument();
    expect(screen.queryByText("ONE-SHOT")).toBeNull();
    await act(async () => {});
  });
});
