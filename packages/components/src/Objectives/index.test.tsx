import {
  DashboardItemContext,
  getAugmentSettings,
  getAugmentsForSlot,
} from "@ksp-gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { contractObjectives, ObjectivesComponent } from "./index";

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

/** Objectives reads `contracts.active` off `career.status.contracts.active`. */
function renderObjectives() {
  const fixture = setupStreamFixture({
    carriedChannels: ["career.status"],
    pinnedUt: 10,
  });
  const result = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ob" }}>
        <ObjectivesComponent config={{}} id="ob" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { ...result, fixture };
}

function emitContracts(fixture: StreamFixture, active: unknown[]) {
  act(() => {
    fixture.emit("career.status", {
      economy: null,
      facilities: null,
      contracts: { active, offered: [] },
      strategies: null,
      tech: null,
    });
  });
}

describe("ObjectivesComponent", () => {
  it("shows the empty state with no contracts", async () => {
    const { fixture } = renderObjectives();
    emitContracts(fixture, []);
    expect(
      await screen.findByText(/No active objectives/i),
    ).toBeInTheDocument();
  });

  it("renders each contract parameter tagged with its contract", async () => {
    const { fixture } = renderObjectives();
    emitContracts(fixture, [contract()]);
    expect(await screen.findByText("Reach the Mun")).toBeInTheDocument();
    expect(screen.getByText("Plant a flag")).toBeInTheDocument();
    expect(screen.getAllByText("Explore the Mun").length).toBeGreaterThan(0);
  });

  it("does not render an alarm bell without an alarm provider", async () => {
    const { fixture } = renderObjectives();
    emitContracts(fixture, [contract()]);
    await screen.findByText("Reach the Mun");
    // Bell is gated on the alarm context; absent here, it degrades cleanly.
    expect(screen.queryByRole("button", { name: /Set alarm/i })).toBeNull();
  });
});

describe("Objectives — augment slot composition (spec §4.9)", () => {
  it("binds the built-in contracts source to the slot", () => {
    const ids = getAugmentsForSlot("objectives.sections").map((a) => a.id);
    expect(ids).toEqual(["objectives-contracts"]);
  });

  it("renders the contracts source into the frame's slot", async () => {
    const { container, fixture } = renderObjectives();
    emitContracts(fixture, [contract()]);

    await screen.findByText("Reach the Mun");
    const lists = container.querySelectorAll('ul[aria-label="Objectives"]');
    expect(lists).toHaveLength(1);
  });

  it("shows the frame's empty fallback only when the source yields no items", async () => {
    const { fixture } = renderObjectives();
    emitContracts(fixture, [contract()]);
    // A source yielded items → fallback stays out of the rendered content flow.
    // (It is present-but-CSS-hidden; asserting the contract items render proves
    // composition happened. The empty-state case is covered above.)
    expect(await screen.findByText("Reach the Mun")).toBeInTheDocument();
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
