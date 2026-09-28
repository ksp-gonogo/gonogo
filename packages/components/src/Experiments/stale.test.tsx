import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ExperimentsComponent } from "./index";

/**
 * When the science channels stop being current the widget keeps the instrument
 * list, marks each held row and disables its controls.
 */

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function mount(fixture: ReturnType<typeof setupStreamFixture>) {
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "expt-stale" }}>
        <ExperimentsComponent id="expt-stale" w={6} h={7} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return container;
}

/** One instrument holding data (so Transmit renders) and a lab beside it. */
function emitScience(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.emit("science.experiments", [
      { subjectId: "mysteryGoo@KerbinSrfLanded", dataAmount: 12 },
    ]);
    fixture.emit("science.instruments", [
      {
        partId: "77",
        partName: "Mystery Goo™ Containment Unit",
        experimentId: "mysteryGoo",
        deployed: false,
        inoperable: false,
        rerunnable: false,
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
}

/** Drop the link, then run a frame: nothing else re-derives the readings. */
function goStale(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("Experiments when the science channels are held", () => {
  it("keeps every instrument and lab row, marks each, and kills Transmit", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    const container = mount(fixture);
    emitScience(fixture);
    await waitFor(() =>
      expect(screen.getByText("Mystery Goo™ Containment Unit")).toBeTruthy(),
    );
    // Control: without it a widget that always marked and disabled would pass.
    expect(screen.queryAllByText("OFFLINE")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Transmit/ })).toBeEnabled();

    goStale(fixture);

    expect(screen.getByText("Mystery Goo™ Containment Unit")).toBeTruthy();
    expect(screen.getByText("DATA")).toBeTruthy();
    expect(screen.getByText("Mobile Processing Lab MPL-LG-2")).toBeTruthy();
    expect(screen.getByText("OPERATIONAL")).toBeTruthy();
    // One mark per row that carries held state: the instrument's and the lab's.
    expect(screen.getAllByText("OFFLINE")).toHaveLength(2);
    // Inert but still shown: hiding it would say the instrument has nothing to send.
    expect(screen.getByRole("button", { name: /Transmit/ })).toBeDisabled();
    expect(visibleText(container)).toContain("Transmit");
  });

  it("marks the held science total on the figure itself", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    const container = mount(fixture);
    emitScience(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("12.0"));
    expect(container.querySelector("[data-held]")).toBeNull();

    goStale(fixture);

    // The mark must carry its currency caption, or it looks marked and says nothing.
    const held = container.querySelector("[data-held]");
    expect(held).not.toBeNull();
    expect(held?.querySelector("[data-unit-currency]")).not.toBeNull();
    // Still drawing the number, not a dash.
    expect(visibleText(container)).toContain("12.0");
  });
});
