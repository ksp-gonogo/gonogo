import type { DataKey, MockDataSource } from "@ksp-gonogo/core";
import { clearAugments, registerAugment } from "@ksp-gonogo/core";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  parseTechNodes,
  type TechNodeBadgeContext,
  TechTreeComponent,
} from "./index";

const KEYS: DataKey[] = [
  { key: "tech.nodes" },
  { key: "career.science" },
  { key: "kc.scene" },
];

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

describe("TechTreeComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
    clearAugments();
  });

  it("shows awaiting placeholder before any telemetry", () => {
    render(<TechTreeComponent config={{}} id="tt" />);
    expect(screen.getByText(/Awaiting tech telemetry/i)).toBeInTheDocument();
  });

  it("shows all nodes by default (no empty first paint)", () => {
    render(<TechTreeComponent config={{}} id="tt" />);
    act(() => {
      source.emit("tech.nodes", SAMPLE_NODES);
      source.emit("career.science", 100);
      source.emit("kc.scene", "SpaceCenter");
    });
    // Default filter is "All" — every node is present on first paint.
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Basic Rocketry")).toBeInTheDocument();
    expect(screen.getByText("Advanced Rocketry")).toBeInTheDocument();
  });

  it("filters to Researchable on demand", async () => {
    const user = userEvent.setup();
    render(<TechTreeComponent config={{}} id="tt" />);
    act(() => {
      source.emit("tech.nodes", SAMPLE_NODES);
      source.emit("career.science", 100);
      source.emit("kc.scene", "SpaceCenter");
    });
    await user.click(screen.getByRole("button", { name: "Researchable" }));
    // Basic Rocketry (parent unlocked, affordable) is researchable-now.
    expect(screen.getByText("Basic Rocketry")).toBeInTheDocument();
    // Start (owned) and Advanced Rocketry (parent locked) are filtered out.
    expect(screen.queryByText("Start")).toBeNull();
    expect(screen.queryByText("Advanced Rocketry")).toBeNull();
  });

  it("expands a node to show description, parents, and parts", async () => {
    const user = userEvent.setup();
    render(<TechTreeComponent config={{}} id="tt" />);
    act(() => {
      source.emit("tech.nodes", SAMPLE_NODES);
      source.emit("career.science", 100);
      source.emit("kc.scene", "SpaceCenter");
    });
    await user.click(screen.getByText("Basic Rocketry"));
    expect(
      screen.getByText("How hard can Rocket Science be anyway?"),
    ).toBeInTheDocument();
    expect(screen.getByText("start")).toBeInTheDocument(); // parent chip
    expect(screen.getByText("LV-T45 Liquid Fuel Engine")).toBeInTheDocument();
  });

  it("arms and confirms tech.unlock with the node id", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<TechTreeComponent config={{}} id="tt" />);
    act(() => {
      source.emit("tech.nodes", SAMPLE_NODES);
      source.emit("career.science", 100);
      source.emit("kc.scene", "SpaceCenter");
    });
    await user.click(screen.getByText("Basic Rocketry"));
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await user.click(screen.getByRole("button", { name: /Confirm unlock/i }));
    expect(onExecute).toHaveBeenCalledWith("tech.unlock[basicRocketry]");
  });

  it("renders the tiered graph at wide sizes and opens a detail dialog on click", async () => {
    const user = userEvent.setup();
    render(<TechTreeComponent config={{}} id="tt" w={16} h={12} />);
    act(() => {
      source.emit("tech.nodes", SAMPLE_NODES);
      source.emit("career.science", 100);
      source.emit("kc.scene", "SpaceCenter");
    });
    // Graph cards are buttons labelled with title + state + cost.
    const card = screen.getByRole("button", { name: /Basic Rocketry/ });
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
    render(<TechTreeComponent config={{}} id="tt" />);
    act(() => {
      source.emit("tech.nodes", SAMPLE_NODES);
      source.emit("career.science", 2);
      source.emit("kc.scene", "SpaceCenter");
    });
    await user.click(screen.getByText("Basic Rocketry"));
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect((unlock as HTMLButtonElement).disabled).toBe(true);
  });

  it("exposes the per-node badges slot with no bound augment (empty is fine)", () => {
    // No augment registered → the slot composes nothing and the list renders
    // exactly as before, one row per node.
    render(<TechTreeComponent config={{}} id="tt" />);
    act(() => {
      source.emit("tech.nodes", SAMPLE_NODES);
      source.emit("career.science", 100);
      source.emit("kc.scene", "SpaceCenter");
    });
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Basic Rocketry")).toBeInTheDocument();
    expect(screen.queryByTestId("tech-badge")).not.toBeInTheDocument();
  });

  it("renders a bound augment once per node row, carrying each node's identity", () => {
    // A test Uplink binds `tech-tree.badges` and echoes the slot props back.
    // Proves (a) the slot is exposed, (b) an augment composes into it, and (c)
    // the per-node props carry the right node so the badge lands on the right
    // row. `requires` is omitted so no Domain presence gate applies.
    registerAugment<"tech-tree.badges">({
      id: "test-tech-badge",
      augments: "tech-tree.badges",
      component: ({ node }: TechNodeBadgeContext) => (
        <span data-testid="tech-badge" data-node={node.id}>
          {node.id} ✓
        </span>
      ),
    });

    render(<TechTreeComponent config={{}} id="tt" />);
    act(() => {
      source.emit("tech.nodes", SAMPLE_NODES);
      source.emit("career.science", 100);
      source.emit("kc.scene", "SpaceCenter");
    });

    // One badge per node in the (default) list view.
    const badges = screen.getAllByTestId("tech-badge");
    expect(badges).toHaveLength(SAMPLE_NODES.length);
    // The badge sits inside its own node's row (props identity is correct).
    const basicRow = screen.getByText("Basic Rocketry").closest("li");
    expect(basicRow).not.toBeNull();
    expect(
      within(basicRow as HTMLElement).getByTestId("tech-badge"),
    ).toHaveTextContent("basicRocketry ✓");
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
