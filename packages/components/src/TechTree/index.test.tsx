import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { parseTechNodes, TechTreeComponent } from "./index";

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
  });

  it("shows awaiting placeholder before any telemetry", () => {
    render(<TechTreeComponent config={{}} id="tt" />);
    expect(screen.getByText(/Awaiting tech telemetry/i)).toBeInTheDocument();
  });

  it("filters to Researchable by default", () => {
    render(<TechTreeComponent config={{}} id="tt" />);
    act(() => {
      source.emit("tech.nodes", SAMPLE_NODES);
      source.emit("career.science", 100);
      source.emit("kc.scene", "SpaceCenter");
    });
    // Basic Rocketry (Researchable) is visible.
    expect(screen.getByText("Basic Rocketry")).toBeInTheDocument();
    // Start (Available) and Advanced Rocketry (Unavailable) are filtered out.
    expect(screen.queryByText("Start")).toBeNull();
    expect(screen.queryByText("Advanced Rocketry")).toBeNull();
  });

  it("expands a node to show description, parents, and parts", () => {
    render(<TechTreeComponent config={{}} id="tt" />);
    act(() => {
      source.emit("tech.nodes", SAMPLE_NODES);
      source.emit("career.science", 100);
      source.emit("kc.scene", "SpaceCenter");
    });
    fireEvent.click(screen.getByText("Basic Rocketry"));
    expect(
      screen.getByText("How hard can Rocket Science be anyway?"),
    ).toBeInTheDocument();
    expect(screen.getByText("start")).toBeInTheDocument(); // parent chip
    expect(screen.getByText("LV-T45 Liquid Fuel Engine")).toBeInTheDocument();
  });

  it("arms and confirms tech.unlock with the node id", async () => {
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
    fireEvent.click(screen.getByText("Basic Rocketry"));
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm unlock/i }));
    expect(onExecute).toHaveBeenCalledWith("tech.unlock[basicRocketry]");
  });

  it("disables Unlock when science is insufficient", () => {
    render(<TechTreeComponent config={{}} id="tt" />);
    act(() => {
      source.emit("tech.nodes", SAMPLE_NODES);
      source.emit("career.science", 2);
      source.emit("kc.scene", "SpaceCenter");
    });
    fireEvent.click(screen.getByText("Basic Rocketry"));
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect((unlock as HTMLButtonElement).disabled).toBe(true);
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
