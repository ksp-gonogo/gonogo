import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ExperimentsComponent } from "./index";

afterEach(() => clearActionHandlers());

function mountWithTotal() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "held-tip" }}>
        <ExperimentsComponent id="held-tip" w={6} h={7} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("science.experiments", [
      { subjectId: "mysteryGoo@KerbinSrfLanded", dataAmount: 7.5 },
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
  });
  return fixture;
}

const openTips = () =>
  [...document.querySelectorAll("[data-tooltip-tip]")].map(
    (t) => t.textContent,
  );

describe("Experiments: the stored-data total's tooltips", () => {
  it("opens only the held tip on a held figure, so nothing sits over it", async () => {
    const fixture = mountWithTotal();
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await screen.findByText(/7\.5/);
    fireEvent.pointerEnter(
      document.querySelector("[data-figure]") as HTMLElement,
    );

    expect(openTips()).toEqual([expect.stringMatching(/^OFFLINE, as of /)]);
  });

  it("opens the meaning of the figure while it is current", async () => {
    mountWithTotal();

    await screen.findByText(/7\.5/);
    fireEvent.pointerEnter(
      document.querySelector(
        "[data-tooltip='Total stored science data (mits)']",
      ) as HTMLElement,
    );

    expect(openTips()).toEqual(["Total stored science data (mits)"]);
  });
});
