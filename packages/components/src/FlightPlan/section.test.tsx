import { DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { emitAt, KERBIN } from "../test/bodyEmits";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FlightPlanComponent } from "./index";
import type { FlightPlan } from "./plan";
import { applyPlan, resetPlanStoreCache, savePlan } from "./planStore";
import { FlightPlanSection } from "./section";

const plan: FlightPlan = {
  id: "mun-east",
  name: "Mun landing, east",
  reserve: 0.1,
  steps: [
    { id: "s1", kind: "launch", inputs: { heading: 90 }, intents: [] },
    {
      id: "s2",
      kind: "reach-orbit",
      inputs: { body: "Kerbin", periapsis: 80_000 },
      needsDv: 3_400,
      intents: [],
    },
    {
      id: "s3",
      kind: "transfer",
      inputs: { to: "Mun" },
      needsDv: 860,
      intents: [],
    },
    {
      id: "s4",
      kind: "land",
      inputs: { on: "Mun" },
      needsDv: 890,
      intents: [],
    },
  ],
};

function renderSection(fixture: ReturnType<typeof setupStreamFixture>) {
  return render(
    <fixture.Provider>
      <ModalProvider>
        <FlightPlanSection />
      </ModalProvider>
    </fixture.Provider>,
  );
}

function emitCraft(fixture: ReturnType<typeof setupStreamFixture>, dv: number) {
  emitAt(fixture, KERBIN);
  fixture.emit("dv.summary", {
    stageCount: 3,
    totalDvVac: dv,
    totalDvAsl: dv,
    totalDvActual: dv,
  });
}

describe("FlightPlanSection", () => {
  it("offers a new plan or a saved one when none is applied", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 112, suspendFrames: true });
    renderSection(fixture);
    act(() => emitCraft(fixture, 5_030));
    await waitFor(() => expect(visibleText()).toContain("No plan applied"));
    expect(
      screen.getByRole("button", { name: "New plan" }),
    ).toBeInTheDocument();
  });

  it("lists every step with its state and names the m/s a step is short", async () => {
    savePlan(plan);
    applyPlan("v1", plan.id);
    const fixture = setupStreamFixture({ pinnedUt: 112, suspendFrames: true });
    renderSection(fixture);
    act(() => emitCraft(fixture, 2_000));
    await waitFor(() => expect(visibleText()).toContain("Reach orbit"));
    expect(visibleText()).toContain("Land");
    expect(visibleText()).toMatch(/-\d+ m\/s/);
  });

  it("opens the save sheet with the plan's steps", async () => {
    savePlan(plan);
    applyPlan("v1", plan.id);
    const fixture = setupStreamFixture({ pinnedUt: 112, suspendFrames: true });
    renderSection(fixture);
    act(() => emitCraft(fixture, 5_620));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save plan" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(
      await screen.findByRole("dialog", { name: "Save plan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Every save" }),
    ).toBeInTheDocument();
    await act(async () => {});
  });
});

describe("FlightPlanSection in the editor", () => {
  it("edits the plan as step cards and adds a step from Add step", async () => {
    savePlan(plan);
    applyPlan("editor", plan.id);
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    render(
      <fixture.Provider>
        <ModalProvider>
          <FlightPlanSection />
        </ModalProvider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "Editor" });
      emitCraft(fixture, 5_030);
    });
    fireEvent.click(await screen.findByRole("button", { name: "+ Land" }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Land" }).length).toBe(2),
    );
    await act(async () => {});
  });

  it("adds an intent inside a step", async () => {
    savePlan(plan);
    applyPlan("editor", plan.id);
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    render(
      <fixture.Provider>
        <ModalProvider>
          <FlightPlanSection />
        </ModalProvider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "Editor" });
      emitCraft(fixture, 5_030);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Reach orbit" }));
    const step = await screen.findByRole("dialog", { name: "Reach orbit" });
    fireEvent.click(within(step).getByRole("button", { name: "+ Intent" }));
    const dialog = await screen.findByRole("dialog", { name: "Add intent" });
    fireEvent.change(within(dialog).getByLabelText("Action group"), {
      target: { value: "2" },
    });
    fireEvent.change(within(dialog).getByLabelText("Action"), {
      target: { value: "Jettison fairing" },
    });
    fireEvent.change(within(dialog).getByLabelText("Kilometres"), {
      target: { value: "55" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(within(step).getByText("Jettison fairing")).toBeInTheDocument(),
    );
    fireEvent.click(within(step).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(visibleText()).toContain("Jettison fairing"));
    expect(visibleText()).toContain("≥ 55.0 km");
    await act(async () => {});
  });

  it("shows the prediction's result on each step and names the first that fails", async () => {
    savePlan(plan);
    applyPlan("editor", plan.id);
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    render(
      <fixture.Provider>
        <ModalProvider>
          <FlightPlanSection />
        </ModalProvider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "Editor" });
      emitCraft(fixture, 5_030);
      // A Topic no contract names is never subscribed on the stub's wire, so the gate is opened by hand.
      (
        fixture.transport as never as { subscribedTopics: Set<string> }
      ).subscribedTopics.add("design.planResult");
      fixture.emit("design.planResult", {
        planId: plan.id,
        steps: { s2: { met: 9, of: 9 }, s3: { met: 3, of: 9 } },
      });
    });
    await waitFor(() => expect(visibleText()).toContain("Likely to fail"));
    expect(visibleText()).toContain("9 of 9");
    expect(visibleText()).toContain("3 of 9");
    await act(async () => {});
  });

  it("draws each step's Δv bar as what is left against what the step needs", async () => {
    savePlan(plan);
    applyPlan("editor", plan.id);
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    render(
      <fixture.Provider>
        <ModalProvider>
          <FlightPlanSection />
        </ModalProvider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "Editor" });
      emitCraft(fixture, 5_030);
    });
    await waitFor(() => expect(screen.getAllByRole("meter")).toHaveLength(3));
    const [orbit, transfer, land] = screen.getAllByRole("meter");
    // Reach orbit: 5030 left of 3400 needed, a full bar.
    expect(Number(orbit?.getAttribute("aria-valuenow"))).toBe(
      Number(orbit?.getAttribute("aria-valuemax")),
    );
    // Transfer: 1630 left of 860 needed, a full bar.
    expect(Number(transfer?.getAttribute("aria-valuenow"))).toBe(
      Number(transfer?.getAttribute("aria-valuemax")),
    );
    // Land: 770 left of 890 needed, 120 short, so the bar is under full.
    expect(Number(land?.getAttribute("aria-valuenow"))).toBeLessThan(
      Number(land?.getAttribute("aria-valuemax")),
    );
    expect(visibleText()).toContain("770 m/s of 890 m/s");
    await act(async () => {});
  });
});

describe("FlightPlanSection after a launch from the editor", () => {
  function emitVessel(
    fixture: ReturnType<typeof setupStreamFixture>,
    vesselId: string,
    situation: number,
  ) {
    emitCraft(fixture, 5_620);
    fixture.emit("spaceCenter.scene", { scene: "Flight" });
    fixture.emit("vessel.identity", {
      vesselId,
      name: "Mun Hopper",
      vesselType: 0,
      situation,
      parentBodyIndex: KERBIN.index,
      launchUt: 0,
    });
  }
  const applied = () =>
    JSON.parse(localStorage.getItem("gonogo.flightPlans.applied") ?? "{}");

  it("carries the plan applied in the editor to the vessel on the pad", async () => {
    savePlan(plan);
    applyPlan("editor", plan.id);
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    renderSection(fixture);
    act(() => emitVessel(fixture, "pad-1", 2));
    await waitFor(() => expect(visibleText()).toContain("Reach orbit"));
    expect(applied()["pad-1"]).toBe(plan.id);
    expect(applied().editor).toBeUndefined();
  });

  it("leaves the editor's plan alone for a vessel already flying", async () => {
    savePlan(plan);
    applyPlan("editor", plan.id);
    const fixture = setupStreamFixture({ pinnedUt: 112, suspendFrames: true });
    renderSection(fixture);
    act(() => emitVessel(fixture, "flying-1", 1));
    await waitFor(() => expect(visibleText()).toContain("No plan applied"));
    expect(applied()["flying-1"]).toBeUndefined();
    expect(applied().editor).toBe(plan.id);
  });
});

/*
 * The whole path an operator takes: apply a plan in the VAB's design pane, launch,
 * and find it on the Flight Plan tile in flight, where the pane is gone.
 */
describe("a plan applied in the VAB, after launch", () => {
  const LAUNCH_UT = 77_563;

  function inTheVab(fixture: ReturnType<typeof setupStreamFixture>) {
    emitCraft(fixture, 5_620);
    fixture.emit(
      "spaceCenter.scene",
      { scene: "Editor" },
      { validAt: LAUNCH_UT - 60, deliveredAt: LAUNCH_UT - 60 },
    );
  }

  function launched(
    fixture: ReturnType<typeof setupStreamFixture>,
    vesselId: string,
    situation: number,
    launchUt: number | null,
  ) {
    fixture.emit(
      "spaceCenter.scene",
      { scene: "Flight" },
      { validAt: LAUNCH_UT, deliveredAt: LAUNCH_UT },
    );
    fixture.emit(
      "vessel.identity",
      {
        vesselId,
        name: "Splashdown",
        vesselType: 0,
        situation,
        parentBodyIndex: KERBIN.index,
        launchUt,
      },
      { validAt: LAUNCH_UT, deliveredAt: LAUNCH_UT },
    );
  }

  async function applyInTheVab() {
    resetPlanStoreCache();
    localStorage.clear();
    const vab = setupStreamFixture({ suspendFrames: true });
    const pane = renderSection(vab);
    act(() => inTheVab(vab));
    fireEvent.click(await screen.findByRole("button", { name: "New plan" }));
    await waitFor(() => expect(visibleText()).toContain("Launch"));
    expect(localStorage.getItem("gonogo.flightPlans.editorAppliedAt")).toBe(
      String(LAUNCH_UT - 60),
    );
    pane.unmount();
  }

  function renderTile(fixture: ReturnType<typeof setupStreamFixture>) {
    return render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "plan-tile" }}>
          <FlightPlanComponent id="plan-tile" h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
  }

  it("is on the Flight Plan tile once the craft is on the pad", async () => {
    await applyInTheVab();
    const flight = setupStreamFixture({ suspendFrames: true });
    renderTile(flight);
    act(() => launched(flight, "pad-1", 2, null));
    await waitFor(() => expect(visibleText()).not.toContain("No plan applied"));
    expect(visibleText()).toContain("Launch");
  });

  it("is on the tile when the pad frame never arrives and the craft left the pad after the plan was applied", async () => {
    await applyInTheVab();
    const flight = setupStreamFixture({ suspendFrames: true });
    renderTile(flight);
    act(() => launched(flight, "boosted-1", 5, LAUNCH_UT));
    await waitFor(() => expect(visibleText()).not.toContain("No plan applied"));
  });

  it("is not given to a craft that left the pad before the plan was applied", async () => {
    await applyInTheVab();
    const flight = setupStreamFixture({ suspendFrames: true });
    renderTile(flight);
    act(() => launched(flight, "old-1", 5, LAUNCH_UT - 3_600));
    await waitFor(() => expect(visibleText()).toContain("No plan applied"));
    await act(async () => {});
  });
});
