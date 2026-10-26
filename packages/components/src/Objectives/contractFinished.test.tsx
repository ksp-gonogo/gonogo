import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ObjectivesComponent } from "./index";

afterEach(() => {
  clearActionHandlers();
});

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "obj-finished" }}>
        <ObjectivesComponent id="obj-finished" w={5} h={8} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("career.status", {
      balances: null,
      facilities: null,
      contracts: { active: [], offered: [] },
      strategies: null,
      tech: null,
    });
    fixture.emit("spaceCenter.scene", { scene: "Flight" });
    fixture.store.beginFrame();
  });
  return fixture;
}

const completion = (id: string, title: string) => ({
  id,
  title,
  agent: "Kerbin Space Program",
  outcome: "Completed",
});

describe("Objectives: contracts heard completing", () => {
  it("shows a contract that completes as completed, and clears it when the scene changes", async () => {
    const fixture = mount();

    act(() => {
      fixture.emit(
        "career.contractEvent",
        completion("90", "Launch a new vessel"),
      );
      fixture.store.beginFrame();
    });
    await waitFor(() =>
      expect(visibleText(document.body)).toContain("Launch a new vessel"),
    );
    expect(visibleText(document.body)).toContain("reached");

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.store.beginFrame();
    });
    await waitFor(() =>
      expect(visibleText(document.body)).not.toContain("Launch a new vessel"),
    );
  });

  it("does not list a contract that failed", async () => {
    const fixture = mount();

    act(() => {
      fixture.emit("career.contractEvent", {
        ...completion("51", "Test the RT-5"),
        outcome: "Failed",
      });
      fixture.store.beginFrame();
    });
    await act(async () => {});
    expect(visibleText(document.body)).not.toContain("Test the RT-5");
  });
});
