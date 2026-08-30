import {
  clearActionHandlers,
  clearAugments,
  DashboardItemContext,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { parseTechNodes, TechTreeComponent } from "./index";

/**
 * Stream-migrated widget test (mirrors `stream.test.tsx`/`dual-run.test.tsx`
 * in this directory): `career.status` (tech nodes + science) and
 * `spaceCenter.scene` are ONE-ARG canonical reads with no legacy fallback
 * at all, so every render here runs off a real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`. Sample
 * nodes are emitted directly onto `career.status.tech.nodes` using the
 * LEGACY short-form shape (`state`/`parents` on each node), `parseTechNodes`
 * (index.tsx) explicitly accepts this exact shape as one of its two
 * supported inputs (its own doc comment: "Accepts BOTH the legacy
 * GonogoTelemetry tech.nodes shape... and the career-detail wire shape"),
 * so this is a legitimate value for that field, not a bypass, it's what
 * lets these tests keep exercising the rich per-node `parts` rendering
 * (`parts` has no field on the real wire; `description` gained one in
 * contract 14.1 and is covered off the wire shape in `dual-run.test.tsx`).
 * `tech.unlock[...]` (the spend command, unmapped) stays on the legacy
 * `useExecuteAction("data")` fallback: a `setupMockDataSource` AUX
 * supplies the `onExecute` spy for the arm-then-confirm test.
 */
const CARRIED_CHANNELS = ["career.status", "spaceCenter.scene"];

const SAMPLE_NODES = [
  {
    id: "start",
    title: "Start",
    description: "The technology we started out with.",
    scienceCost: 0,
    state: "Available",
    parents: [],
    parts: [
      {
        name: "mk1pod.v2",
        title: "Mk1 Command Pod",
        manufacturer: "Kerlington Model Rockets",
        category: "Pods",
        entryCost: 0,
        purchased: true,
      },
    ],
  },
  {
    id: "basicRocketry",
    title: "Basic Rocketry",
    description: "How hard can Rocket Science be anyway?",
    scienceCost: 5,
    state: "Researchable",
    parents: ["start"],
    parts: [
      {
        name: "liquidEngine2",
        title: "LV-T45 Liquid Fuel Engine",
        manufacturer: "Jebediah Kerman's Junkyard",
        category: "Engine",
        entryCost: 0,
        purchased: false,
      },
    ],
  },
  {
    id: "advRocketry",
    title: "Advanced Rocketry",
    description: "We're getting fancy.",
    scienceCost: 45,
    state: "Unavailable",
    parents: ["basicRocketry"],
    parts: [],
  },
];

function careerStatusFrom(
  nodes: typeof SAMPLE_NODES,
  science: number,
): Record<string, unknown> {
  return {
    economy: { funds: 0, reputation: 0, science },
    facilities: null,
    contracts: null,
    strategies: null,
    tech: { unlockedCount: 0, unlockedIds: [], nodes },
  };
}

function renderTree(fixture: StreamFixture) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "tt" }}>
        <TechTreeComponent config={{}} id="tt" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

describe("TechTreeComponent", () => {
  // Reset the action-handler + augment registries at the START of each test,
  // by this point the prior test's tree is already unmounted (RTL
  // auto-cleanup), so these registry mutations never fire against a live
  // component (no manual `cleanup()` needed to order them).
  beforeEach(() => {
    clearActionHandlers();
    clearAugments();
  });

  it("shows awaiting placeholder before any telemetry", () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTree(fixture);
    expect(screen.getByText(/Awaiting tech telemetry/i)).toBeInTheDocument();
  });

  it("shows all nodes by default (no empty first paint)", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTree(fixture);
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", careerStatusFrom(SAMPLE_NODES, 100));
    });
    // Default filter is "All", every node is present on first paint.
    await waitFor(() => expect(screen.getByText("Start")).toBeInTheDocument());
    expect(screen.getByText("Basic Rocketry")).toBeInTheDocument();
    expect(screen.getByText("Advanced Rocketry")).toBeInTheDocument();
  });

  it("filters to Researchable on demand", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTree(fixture);
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", careerStatusFrom(SAMPLE_NODES, 100));
    });
    await waitFor(() => expect(screen.getByText("Start")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Researchable" }));
    // Basic Rocketry (parent unlocked, affordable) is researchable-now.
    expect(screen.getByText("Basic Rocketry")).toBeInTheDocument();
    // Start (owned) and Advanced Rocketry (parent locked) are filtered out.
    expect(screen.queryByText("Start")).toBeNull();
    expect(screen.queryByText("Advanced Rocketry")).toBeNull();
  });

  it("expands a node to show description, parents, and parts", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTree(fixture);
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", careerStatusFrom(SAMPLE_NODES, 100));
    });
    await waitFor(() =>
      expect(screen.getByText("Basic Rocketry")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Basic Rocketry"));
    expect(
      screen.getByText("How hard can Rocket Science be anyway?"),
    ).toBeInTheDocument();
    expect(screen.getByText("start")).toBeInTheDocument(); // parent chip
    expect(visibleText()).toContain("LV-T45 Liquid Fuel Engine");
  });

  it("arms and confirms tech.unlock with the node id", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });

    renderTree(fixture);
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", careerStatusFrom(SAMPLE_NODES, 100));
    });
    await waitFor(() =>
      expect(screen.getByText("Basic Rocketry")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Basic Rocketry"));
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await user.click(screen.getByRole("button", { name: /Confirm unlock/i }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "career.tech.unlock",
      );
      expect(sent).toMatchObject({
        args: { techId: "basicRocketry" },
        vantage: "meta",
      });
    });
  });

  it("renders the tiered graph at wide sizes and opens a detail dialog on click", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tt" }}>
          <TechTreeComponent config={{}} id="tt" w={16} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", careerStatusFrom(SAMPLE_NODES, 100));
    });
    // Graph cards are buttons labelled with title + state + cost.
    const card = await screen.findByRole("button", { name: /Basic Rocketry/ });
    await user.click(card);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Detail surfaces the description and the unlock control.
    expect(
      screen.getByText("How hard can Rocket Science be anyway?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("disables Unlock when science is insufficient", async () => {
    const user = userEvent.setup();
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTree(fixture);
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", careerStatusFrom(SAMPLE_NODES, 2));
    });
    await waitFor(() =>
      expect(screen.getByText("Basic Rocketry")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Basic Rocketry"));
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect((unlock as HTMLButtonElement).disabled).toBe(true);
  });

  it("exposes the per-node badges slot with no bound augment (empty is fine)", async () => {
    // No augment registered → the slot composes nothing and the list renders
    // exactly as before, one row per node.
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderTree(fixture);
    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      fixture.emit("career.status", careerStatusFrom(SAMPLE_NODES, 100));
    });
    await waitFor(() => expect(screen.getByText("Start")).toBeInTheDocument());
    expect(screen.getByText("Basic Rocketry")).toBeInTheDocument();
    expect(screen.queryByTestId("tech-badge")).not.toBeInTheDocument();
  });
});

describe("parseTechNodes", () => {
  it("returns null for non-array input", () => {
    expect(parseTechNodes(null)).toBeNull();
    expect(parseTechNodes(undefined)).toBeNull();
    expect(parseTechNodes({})).toBeNull();
  });

  it("drops entries without an id", () => {
    const parsed = parseTechNodes([
      { id: "good", title: "Good", scienceCost: 0, state: "Available" },
      { title: "No id" },
      { id: 42 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].id).toBe("good");
  });

  it("clamps unknown states to Unavailable", () => {
    const parsed = parseTechNodes([
      { id: "x", title: "X", scienceCost: 0, state: "Floomp" },
    ]);
    expect(parsed?.[0].state).toBe("Unavailable");
  });

  it("preserves description, parents, and parts when present", () => {
    const parsed = parseTechNodes([SAMPLE_NODES[1]]);
    expect(parsed?.[0].description).toBe(
      "How hard can Rocket Science be anyway?",
    );
    expect(parsed?.[0].parents).toEqual(["start"]);
    expect(parsed?.[0].parts[0].title).toBe("LV-T45 Liquid Fuel Engine");
    expect(parsed?.[0].parts[0].purchased).toBe(false);
  });
});
