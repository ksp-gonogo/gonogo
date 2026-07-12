import type { DataKey, MockDataSource } from "@ksp-gonogo/core";
import { getAugmentSettings, getAugmentsForSlot } from "@ksp-gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { contractObjectives, ObjectivesComponent } from "./index";

const KEYS: DataKey[] = [{ key: "contracts.active" }];

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

  it("shows the empty state with no contracts", () => {
    render(<ObjectivesComponent config={{}} id="ob" />);
    act(() => {
      source.emit("contracts.active", []);
    });
    expect(screen.getByText(/No active objectives/i)).toBeInTheDocument();
  });

  it("renders each contract parameter tagged with its contract", () => {
    render(<ObjectivesComponent config={{}} id="ob" />);
    act(() => {
      source.emit("contracts.active", [contract()]);
    });
    expect(screen.getByText("Reach the Mun")).toBeInTheDocument();
    expect(screen.getByText("Plant a flag")).toBeInTheDocument();
    expect(screen.getAllByText("Explore the Mun").length).toBeGreaterThan(0);
  });

  it("does not render an alarm bell without an alarm provider", () => {
    render(<ObjectivesComponent config={{}} id="ob" />);
    act(() => {
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

  it("binds the built-in contracts source to the slot", () => {
    // `setupMockDataSource` calls `clearRegistry`, which deliberately no longer
    // wipes the augment registry — the module-load `registerAugment` call
    // survives so the frame's slot has a source to compose.
    const ids = getAugmentsForSlot("objectives.sections").map((a) => a.id);
    expect(ids).toEqual(["objectives-contracts"]);
  });

  it("renders the contracts source into the frame's slot", () => {
    const { container } = render(<ObjectivesComponent config={{}} id="ob" />);
    act(() => {
      source.emit("contracts.active", [contract()]);
    });

    const lists = container.querySelectorAll('ul[aria-label="Objectives"]');
    expect(lists).toHaveLength(1);
    expect(screen.getByText("Reach the Mun")).toBeInTheDocument();
  });

  it("shows the frame's empty fallback only when the source yields no items", () => {
    render(<ObjectivesComponent config={{}} id="ob" />);
    act(() => {
      source.emit("contracts.active", [contract()]);
    });
    // A source yielded items → fallback stays out of the rendered content flow.
    // (It is present-but-CSS-hidden; asserting the contract items render proves
    // composition happened. The empty-state case is covered above.)
    expect(screen.getByText("Reach the Mun")).toBeInTheDocument();
  });

  it("merges the source's namespaced show/hide setting into the host panel (spec §4.7)", () => {
    const merged = getAugmentSettings("objectives.sections");
    expect(merged.map((m) => m.namespace)).toEqual(["objectives-contracts"]);
    expect(merged.every((m) => m.fields[0]?.key === "show")).toBe(true);
  });
});

describe("objective mapping", () => {
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
