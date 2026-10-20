import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ExperimentsComponent } from "./index";

/**
 * Continuous instruments and the lab's run state, off the real stream: a row
 * that runs over time offers Start or Stop in the card's control slot where a
 * one-shot one offers Deploy, and the lab card carries the same switch.
 */
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const CONTINUOUS = {
  partId: "1001",
  partName: "Seismic Array",
  experimentId: "seismicScan",
  title: "Seismic Scan",
  deployed: null,
  inoperable: false,
  rerunnable: null,
  resettable: null,
  dataIsCollectable: false,
  continuous: true,
};

function mount() {
  const fixture = setupStreamFixture({ suspendFrames: true, pinnedUt: 10 });
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "so-continuous" }}>
        <ExperimentsComponent id="so-continuous" w={9} h={10} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return fixture;
}

describe("Experiments: continuous instruments", () => {
  it("offers Start, not Deploy, on a stopped continuous row and counts none as running", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [
        { ...CONTINUOUS, running: false, producing: false },
      ]);
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Deploy" })).toBeNull();
    expect(screen.getByText("STOPPED")).toBeInTheDocument();
    expect(visibleText()).toContain("0 running");
    expect(visibleText()).not.toContain("deployed");
  });

  it("offers Stop on a running row, shows the issue, and counts it as running", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [
        {
          ...CONTINUOUS,
          running: true,
          producing: false,
          runIssue: "No electric charge",
        },
        {
          ...CONTINUOUS,
          partId: "1002",
          partName: "Gravity Scanner",
          experimentId: "gravityScan",
          title: "Gravity Scan",
          running: true,
          producing: true,
        },
      ]);
    });

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(2),
    );
    expect(screen.getByText("No electric charge")).toBeInTheDocument();
    expect(visibleText()).toContain("2 running");
  });

  it("keeps Deploy on an instrument that is not continuous", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [
        {
          partId: "77",
          partName: "Thermometer",
          experimentId: "temperatureScan",
          deployed: false,
          inoperable: false,
          rerunnable: true,
          resettable: true,
          dataIsCollectable: false,
          continuous: false,
        },
      ]);
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Deploy" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });
});

describe("Experiments: the lab's run state", () => {
  const LAB = {
    partId: "2001",
    partName: "Mobile Processing Lab MPL-LG-2",
    dataStored: 320,
    dataStorage: 750,
    storedScience: 12,
    processingData: false,
    statusText: "Operational",
    scientistCount: 2,
    scienceRate: 4.5,
    scienceCap: 500,
    isOperational: true,
    valueModel: "stock",
  };

  it("offers Start research on a stopped lab, with a STOPPED badge", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [CONTINUOUS]);
      fixture.emit("science.lab", [
        { ...LAB, running: false, producing: false },
      ]);
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start research" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("STOPPED").length).toBeGreaterThan(0);
  });

  it("offers Stop research on a running lab and says why it is idle", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [CONTINUOUS]);
      fixture.emit("science.lab", [
        {
          ...LAB,
          running: true,
          producing: false,
          runIssue: "Not enough power",
        },
      ]);
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Stop research" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Not enough power")).toBeInTheDocument();
  });

  it("offers no switch when the provider could not read whether research is on", async () => {
    const fixture = mount();
    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [CONTINUOUS]);
      fixture.emit("science.lab", [{ ...LAB, running: null }]);
    });

    await waitFor(() =>
      expect(screen.getByText(LAB.partName)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /research/i })).toBeNull();
  });
});
