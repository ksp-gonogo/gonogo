import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FuelStatusComponent } from "./index";

const STAGE = {
  stage: 1,
  dvVac: 2500,
  dvAsl: 2100,
  dvActual: 2300,
  burnTime: 72,
  twrVac: 1.45,
  twrAsl: 1.2,
  twrActual: 1.3,
  thrustVac: 400,
  thrustAsl: 340,
  thrustActual: 360,
  startMass: 8.4,
  endMass: 2.1,
  dryMass: 2.1,
  fuelMass: 6.3,
};

function renderAt(w: number, h: number) {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  const utils = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "fuel-stale" }}>
        <FuelStatusComponent id="fuel-stale" w={w} h={h} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.structure", { currentStage: 1 });
    fixture.emit("dv.summary", {
      stageCount: 2,
      totalDvVac: 4200,
      totalDvAsl: 3800,
      totalDvActual: 3900,
      totalBurnTime: 125,
    });
    fixture.emit("dv.stages", [STAGE]);
  });
  return { fixture, ...utils };
}

function dropTheLink(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

/** The held mark inside the stack a totals caption labels. */
function totalMark(label: string): Element | null {
  const caption = screen.getByText(label);
  return caption.parentElement?.querySelector("[data-held-mark]") ?? null;
}

describe("FuelStatus when the ΔV budget is held", () => {
  it("draws the totals unmarked while the budget is current", async () => {
    renderAt(8, 14);
    await waitFor(() => expect(visibleText()).toContain("3900"));
    expect(totalMark("Total ΔV")).toBeNull();
    expect(totalMark("Total burn")).toBeNull();
  });

  it("marks the held totals rather than captioning them", async () => {
    const { fixture } = renderAt(8, 14);
    await waitFor(() => expect(visibleText()).toContain("3900"));
    dropTheLink(fixture);
    await waitFor(() => expect(totalMark("Total ΔV")).not.toBeNull());
    expect(totalMark("Total burn")).not.toBeNull();
    expect(visibleText()).toContain("3900");
    expect(visibleText()).not.toMatch(/last contact/i);
  });

  it("marks the held hero figure on a tiny tile rather than captioning it", async () => {
    const { fixture, container } = renderAt(3, 3);
    await waitFor(() => expect(visibleText()).toContain("3900"));
    expect(container.querySelector("[data-held-mark]")).toBeNull();
    dropTheLink(fixture);
    await waitFor(() =>
      expect(container.querySelector("[data-held-mark]")).not.toBeNull(),
    );
    expect(visibleText()).not.toMatch(/last contact/i);
  });
});
