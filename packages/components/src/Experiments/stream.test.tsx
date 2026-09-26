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

describe("Experiments: genuinely runs off the stream (M3 science.lab + P4a science.instruments)", () => {
  it("renders the idle-but-operational lab from science.lab and an instrument from science.instruments", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [
        "science.lab",
        "science.instruments",
        "science.experiments",
      ],
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
    expect(screen.getByText("mysteryGoo")).toBeTruthy();
    expect(screen.getByText("DATA")).toBeTruthy();
  });
});
