import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ExperimentsComponent } from "./index";

/**
 * What this widget does when the science channels stop being current.
 *
 * It KEEPS the instrument list, which is right: an instrument joins or leaves
 * the vessel by an event, and no event reaches us down a link that is not
 * delivering, so the last list we were sent is still the list. What stops being
 * true is that the badges describe the vessel now, and that is what each row
 * says for itself.
 *
 * The controls are the half worth a file of its own. Transmit spends an
 * instrument's data, and against a held row it spends data that may already be
 * gone, on an instrument the operator cannot see the current state of. The
 * press would look exactly like a press that worked.
 */

const CARRIED = ["science.lab", "science.instruments", "science.experiments"];

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

describe("Experiments when the science channels are no longer current", () => {
  it("keeps every instrument and lab row, marks each, and kills Transmit", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
    const container = mount(fixture);
    emitScience(fixture);
    await waitFor(() =>
      expect(screen.getByText("Mystery Goo™ Containment Unit")).toBeTruthy(),
    );
    /*
     * The control for everything below. Without it the two assertions after
     * `goStale` would pass just as well on a widget that marked and disabled
     * unconditionally, which is the failure mode a staleness test is most
     * likely to have.
     */
    expect(screen.queryAllByText("OFFLINE")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Transmit/ })).toBeEnabled();

    goStale(fixture);

    // The list is still the list.
    expect(screen.getByText("Mystery Goo™ Containment Unit")).toBeTruthy();
    expect(screen.getByText("DATA")).toBeTruthy();
    expect(screen.getByText("Mobile Processing Lab MPL-LG-2")).toBeTruthy();
    expect(screen.getByText("OPERATIONAL")).toBeTruthy();
    // One mark per row that carries held state: the instrument's and the lab's.
    expect(screen.getAllByText("OFFLINE")).toHaveLength(2);
    // Still on screen, and inert. Hiding it would read as an instrument with
    // nothing to send, which is a different and wrong statement.
    expect(screen.getByRole("button", { name: /Transmit/ })).toBeDisabled();
    expect(visibleText(container)).toContain("Transmit");
  });

  it("marks the held science total on the figure itself", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
    const container = mount(fixture);
    emitScience(fixture);
    await waitFor(() => expect(visibleText(container)).toContain("12.0"));
    expect(container.querySelector("[data-not-current]")).toBeNull();

    goStale(fixture);

    // The kit's own mark, on the quantity, with the caption that says when the
    // number was last a reading of now. A mark with no caption is the one
    // outcome worse than no mark: it looks marked and says nothing.
    const held = container.querySelector("[data-not-current]");
    expect(held).not.toBeNull();
    expect(held?.querySelector("[data-unit-currency]")).not.toBeNull();
    // Still drawing the number, not a dash.
    expect(visibleText(container)).toContain("12.0");
  });
});
