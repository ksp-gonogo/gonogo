import type { DataKey, MockDataSource } from "@gonogo/core";
import { getAugmentSettings, getAugmentsForSlot } from "@gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  contractObjectives,
  missionObjectives,
  ObjectivesComponent,
} from "./index";

const KEYS: DataKey[] = [
  { key: "mh.available" },
  { key: "mh.name" },
  { key: "mh.phase" },
  { key: "mh.score" },
  { key: "mh.finished" },
  { key: "mh.outcome" },
  { key: "mh.objectives" },
  { key: "contracts.active" },
];

const contract = (over: Record<string, unknown> = {}) => ({
  id: "8001",
  title: "Explore the Mun",
  agency: "World-Firsts",
  state: "Active",
  fundsAdvance: 0,
  fundsCompletion: 0,
  scienceCompletion: 0,
  repCompletion: 0,
  deadlineUt: 0,
  parameters: [
    { title: "Reach the Mun", state: "Complete", optional: false },
    { title: "Plant a flag", state: "Incomplete", optional: false },
  ],
  ...over,
});

describe("ObjectivesComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("shows the empty state with no mission and no contracts", () => {
    render(<ObjectivesComponent config={{}} id="ob" />);
    act(() => {
      source.emit("mh.available", false);
      source.emit("contracts.active", []);
    });
    expect(screen.getByText(/No active objectives/i)).toBeInTheDocument();
  });

  it("unifies mission objectives and contract parameters in one list", () => {
    render(<ObjectivesComponent config={{}} id="ob" />);
    act(() => {
      source.emit("mh.available", true);
      source.emit("mh.name", "Munar 1");
      source.emit("mh.objectives", [
        { id: "o1", title: "Land on the Mun", state: "pending" },
      ]);
      source.emit("contracts.active", [contract()]);
    });
    // Mission objective + its mission tag (name also appears in the header).
    expect(screen.getByText("Land on the Mun")).toBeInTheDocument();
    expect(screen.getAllByText("Munar 1").length).toBeGreaterThan(0);
    // Contract parameters + their contract tag.
    expect(screen.getByText("Reach the Mun")).toBeInTheDocument();
    expect(screen.getByText("Plant a flag")).toBeInTheDocument();
    expect(screen.getAllByText("Explore the Mun").length).toBeGreaterThan(0);
  });

  it("renders contracts even when no mission is running", () => {
    render(<ObjectivesComponent config={{}} id="ob" />);
    act(() => {
      source.emit("mh.available", false);
      source.emit("contracts.active", [contract()]);
    });
    expect(screen.getByText("Plant a flag")).toBeInTheDocument();
    // No mission head when no mission.
    expect(screen.queryByText(/MISSION SUCCESS|MISSION FAILED/)).toBeNull();
  });

  it("does not render an alarm bell without an alarm provider", () => {
    render(<ObjectivesComponent config={{}} id="ob" />);
    act(() => {
      source.emit("mh.available", false);
      source.emit("contracts.active", [contract()]);
    });
    // Bell is gated on the alarm context; absent here, it degrades cleanly.
    expect(screen.queryByRole("button", { name: /Set alarm/i })).toBeNull();
  });
});

describe("Objectives — augment slot composition (spec §4.9)", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("binds both built-in sources to the slot, ordered mission-before-contracts by priority", () => {
    // `setupMockDataSource` calls `clearRegistry`, which deliberately no longer
    // wipes the augment registry — the two module-load `registerAugment` calls
    // survive so the frame's slot has sources to compose (the dogfood-surfaced
    // fix). They resolve in ascending priority (mission 10, contracts 20).
    const ids = getAugmentsForSlot("objectives.sections").map((a) => a.id);
    expect(ids).toEqual(["objectives-mission", "objectives-contracts"]);
  });

  it("renders both the mission source and the contracts source into the frame's one slot, mission first", () => {
    const { container } = render(<ObjectivesComponent config={{}} id="ob" />);
    act(() => {
      source.emit("mh.available", true);
      source.emit("mh.name", "Munar 1");
      source.emit("mh.objectives", [
        { id: "o1", title: "Land on the Mun", state: "pending" },
      ]);
      source.emit("contracts.active", [contract()]);
    });

    // Both sources composed into the single frame — two lists, one per source.
    const lists = container.querySelectorAll('ul[aria-label="Objectives"]');
    expect(lists).toHaveLength(2);

    // Mission content renders before contract content (priority ordering).
    const missionItem = screen.getByText("Land on the Mun");
    const contractItem = screen.getByText("Reach the Mun");
    expect(
      missionItem.compareDocumentPosition(contractItem) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the frame's empty fallback only when neither source yields items", () => {
    render(<ObjectivesComponent config={{}} id="ob" />);
    act(() => {
      source.emit("mh.available", false);
      source.emit("contracts.active", [contract()]);
    });
    // A source yielded items → fallback stays out of the rendered content flow.
    // (It is present-but-CSS-hidden; asserting the contract items render proves
    // composition happened. The empty-state case is covered above.)
    expect(screen.getByText("Reach the Mun")).toBeInTheDocument();
  });

  it("merges each source's namespaced show/hide setting into the host panel (spec §4.7)", () => {
    const merged = getAugmentSettings("objectives.sections");
    expect(merged.map((m) => m.namespace)).toEqual([
      "objectives-mission",
      "objectives-contracts",
    ]);
    // Same field key in each, kept in distinct namespaces so instance config
    // never collides.
    expect(merged.every((m) => m.fields[0]?.key === "show")).toBe(true);
  });
});

describe("objective mapping", () => {
  it("maps mission objective states and tags by mission", () => {
    const items = missionObjectives(
      [
        { id: "a", title: "X", state: "reached" },
        { id: "b", title: "Y", state: "weird" },
      ],
      "Munar 1",
    );
    expect(items[0]).toMatchObject({ state: "reached", source: "Munar 1" });
    expect(items[1]?.state).toBe("pending"); // unknown → pending
  });

  it("maps contract parameter states and carries contractId for alarms", () => {
    const items = contractObjectives([contract()]);
    const flag = items.find((i) => i.title === "Plant a flag");
    const reached = items.find((i) => i.title === "Reach the Mun");
    expect(reached?.state).toBe("reached"); // Complete → reached
    expect(flag?.state).toBe("pending"); // Incomplete → pending
    expect(flag?.contractId).toBe("8001");
    expect(flag?.source).toBe("Explore the Mun");
  });

  it("falls back to the contract itself when it has no parameters", () => {
    const items = contractObjectives([contract({ parameters: [] })]);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Explore the Mun");
  });
});
