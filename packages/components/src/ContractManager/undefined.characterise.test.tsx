import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ReadingProbe } from "../test/ReadingProbe";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { ContractManagerComponent } from "./index";

/**
 * Pins what ContractManager renders when its reads are absent: `parseContracts`
 * maps both `undefined` and `null` to `null`. Observations, not endorsements.
 */

function newFixture() {
  return setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  });
}

function renderManager(
  fixture: StreamFixture,
  size?: { w: number; h: number },
  { probe = false }: { probe?: boolean } = {},
) {
  return render(
    <fixture.Provider>
      {probe && <ReadingProbe topic="career.status" />}
      <DashboardItemContext.Provider value={{ instanceId: "cm-char" }}>
        <ContractManagerComponent
          config={{}}
          id="cm-char"
          w={size?.w}
          h={size?.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

/** One active contract with a single objective, as `career.status` carries it. */
const CONTRACT = {
  id: "7001",
  title: "Fly above 5000m",
  agency: "Kerbin Aviation",
  state: "Active",
  fundsCompletion: 0,
  scienceCompletion: 0,
  repCompletion: 0,
  deadlineUt: 0,
  parameters: [
    { title: "Altitude band", state: "Incomplete", stateOrdinal: 0 },
  ],
};

describe("ContractManager: nothing has arrived at all", () => {
  it("renders the awaiting placeholder and none of the loaded chrome", () => {
    renderManager(newFixture());

    expect(
      screen.getByText(/Awaiting contract telemetry/i),
    ).toBeInTheDocument();
    // The one place the widget separates "waiting" from "there are none".
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/No active contracts/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept/i })).toBeNull();
  });

  it("renders NOTHING but the panel title in a short box, because the placeholder is itself gated on height", () => {
    // At h=3 the awaiting branch has no body: silent about waiting rather than empty.
    renderManager(newFixture(), { w: 5, h: 3 });

    expect(screen.getByText("CONTRACT MANAGER")).toBeInTheDocument();
    expect(screen.queryByText(/Awaiting contract telemetry/i)).toBeNull();
    expect(screen.queryByText(/No active contracts/i)).toBeNull();
  });
});

describe("ContractManager: the `active === null` absence gate", () => {
  it("fires for a never-arrived topic and does not fire for a confirmed-empty one", async () => {
    const fixture = newFixture();
    renderManager(fixture);

    expect(
      screen.getByText(/Awaiting contract telemetry/i),
    ).toBeInTheDocument();

    act(() => {
      fixture.emit("career.status", { contracts: { active: [] } });
    });

    // An empty array parses to `[]`, so the confident empty-state copy takes over.
    await waitFor(() =>
      expect(screen.getByText(/No active contracts/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Awaiting contract telemetry/i)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      "0 active · 0 offered · 0 recent",
    );
  });

  it("fires for a partial payload whose `contracts` field is null", async () => {
    const fixture = newFixture();
    renderManager(fixture, undefined, { probe: true });

    act(() => {
      // The record arrived without the sub-tree, indistinguishable from nothing arriving.
      fixture.emit("career.status", {
        balances: { funds: 1000, reputation: 0, science: 0 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await screen.findByText("career.status: observed");
    expect(
      screen.getByText(/Awaiting contract telemetry/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No active contracts/i)).toBeNull();
  });
});

describe("ContractManager: null versus undefined", () => {
  it("does NOT distinguish a whole-topic tombstone from a topic that never arrived", async () => {
    const fixture = newFixture();
    renderManager(fixture, undefined, { probe: true });

    act(() => {
      // A tombstone is visible to the widget as `null`, yet renders the same "waiting" copy as a cold start.
      fixture.emit("career.status", null);
    });

    await screen.findByText("career.status: absent");
    expect(
      screen.getByText(/Awaiting contract telemetry/i),
    ).toBeInTheDocument();
  });
});

describe("ContractManager: partial payloads inside an arrived record", () => {
  it("counts absent `offered`/`completedRecent` sub-arrays as zero and hides their sections", async () => {
    const fixture = newFixture();
    renderManager(fixture);

    act(() => {
      // Only `active` present: two never-arrived arrays coerce to a confident 0.
      fixture.emit("career.status", {
        contracts: { active: [CONTRACT] },
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Fly above 5000m")).toBeInTheDocument(),
    );
    expect(screen.getByRole("status").textContent).toBe(
      "1 active · 0 offered · 0 recent",
    );
    expect(screen.queryByText("Offered")).toBeNull();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders a deadline of `no deadline` when the contract's own deadline field is absent", async () => {
    const fixture = newFixture();
    renderManager(fixture);

    act(() => {
      fixture.emit("career.status", {
        contracts: { active: [{ id: "7002", title: "Undated job" }] },
      });
    });

    // An absent deadline becomes a hard 0, which reads as "no deadline" rather than unknown.
    await waitFor(() =>
      expect(screen.getByText("Undated job")).toBeInTheDocument(),
    );
    expect(visibleText()).toContain("no deadline");
  });
});
