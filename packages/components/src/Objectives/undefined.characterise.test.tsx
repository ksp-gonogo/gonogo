import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { ObjectivesComponent } from "./index";

/**
 * Characterisation: what Objectives DOES today when its one telemetry read is
 * `undefined`, recorded ahead of `useTelemetry` returning a `Reading`.
 *
 * The read is `useTelemetry("career.status")?.contracts?.active`, and the
 * source augment then does `parseContracts(contractsRaw) ?? []` followed by
 * `if (items.length === 0) return null`. Three different absences (topic never
 * arrived, topic tombstoned, `contracts` sub-tree null) and one presence
 * (`active: []`) all funnel into that one `[]`, so the frame's
 * "No active objectives" fallback is what the widget says for every one of
 * them. Pinned as observed, not endorsed.
 */

function newFixture() {
  return setupStreamFixture({
    carriedChannels: ["career.status"],
    pinnedUt: 10,
  });
}

function renderObjectives(fixture: StreamFixture) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "obj-char" }}>
        <ObjectivesComponent config={{}} id="obj-char" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

/** The objectives list, which the source renders only when it has items. */
function objectivesList() {
  return screen.queryByRole("list", { name: "Objectives" });
}

describe("Objectives: nothing has arrived at all", () => {
  it('states "No active objectives" as a live status, with no list at all', () => {
    renderObjectives(newFixture());

    // `parseContracts(undefined) ?? []` yields no items, the source augment
    // returns null, the `Sections` wrapper is genuinely empty, and the frame's
    // fallback shows. A cold topic is reported as a confident absence.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No active objectives");
    expect(objectivesList()).toBeNull();
  });
});

describe("Objectives: the absence gates around `contracts.active`", () => {
  it("renders identically for a never-arrived topic and for a confirmed-empty active list", async () => {
    const fixture = newFixture();
    renderObjectives(fixture);

    const beforeAnything = screen.getByRole("status").textContent;
    expect(beforeAnything).toContain("No active objectives");

    act(() => {
      fixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: { active: [], offered: [] },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    // "KSP says you have no active contracts" and "we have heard nothing"
    // produce the same DOM. This is the conflation the migration reassigns.
    expect(screen.getByRole("status").textContent).toBe(beforeAnything);
    expect(objectivesList()).toBeNull();
  });

  it("fires the `?? []` coercion when the arrived record's `contracts` is null", async () => {
    const fixture = newFixture();
    renderObjectives(fixture);

    act(() => {
      // The record arrived and the sub-tree the source reads did not.
      fixture.emit("career.status", {
        economy: { funds: 1000, reputation: 0, science: 0 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No active objectives",
    );
    expect(objectivesList()).toBeNull();
  });

  it("fires the `?? []` coercion when `contracts.active` itself is null", async () => {
    const fixture = newFixture();
    renderObjectives(fixture);

    act(() => {
      // `parseContracts(null)` returns null, distinct from `[]`, and the `?? []`
      // erases that distinction before the length check ever sees it.
      fixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: { active: null, offered: [] },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No active objectives",
    );
    expect(objectivesList()).toBeNull();
  });

  it("stops firing once one contract parameter arrives, so the gate above is real", async () => {
    const fixture = newFixture();
    renderObjectives(fixture);

    act(() => {
      fixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: {
          active: [
            {
              id: "8001",
              title: "Explore the Mun",
              agency: "World-Firsts",
              parameters: [{ title: "Reach the Mun", state: "Incomplete" }],
            },
          ],
          offered: [],
        },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => expect(objectivesList()).not.toBeNull());
    expect(screen.getByText("Reach the Mun")).toBeInTheDocument();
  });
});

describe("Objectives: null versus undefined", () => {
  it("does NOT distinguish a whole-topic tombstone from a topic that never arrived", async () => {
    const fixture = newFixture();
    renderObjectives(fixture);

    act(() => {
      // The hook hands back `null` for a tombstone rather than `undefined`, so
      // the source COULD tell them apart. It does not: `null?.contracts?.active`
      // is `undefined` and both land on the same empty state.
      fixture.emit("career.status", null);
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No active objectives",
    );
    expect(objectivesList()).toBeNull();
  });
});

describe("Objectives: partial payloads inside an arrived contract", () => {
  it('substitutes the literal source label "Contract" when a parameterless contract has no agency', async () => {
    const fixture = newFixture();
    renderObjectives(fixture);

    act(() => {
      // No `parameters` and no `agency`: `parseParameters(undefined)` gives `[]`,
      // which routes to the whole-contract fallback item, and `c.agency ||
      // "Contract"` fills the missing parent label with a generic word rather
      // than marking it unknown.
      fixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: {
          active: [{ id: "8002", title: "Unspecified job" }],
          offered: [],
        },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Unspecified job")).toBeInTheDocument(),
    );
    expect(screen.getByText("Contract")).toBeInTheDocument();
    // A parameterless contract is stated as `pending`, which is the same glyph
    // and the same screen-reader word an Incomplete parameter gets.
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("treats a parameter with no `state` field as Incomplete rather than unknown", async () => {
    const fixture = newFixture();
    renderObjectives(fixture);

    act(() => {
      fixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: {
          active: [
            {
              id: "8003",
              title: "Stateless job",
              agency: "R&D",
              // `state` absent: `parseParameters` defaults it to "Incomplete",
              // which `contractParamState` maps to "pending".
              parameters: [{ title: "Do the thing" }],
            },
          ],
          offered: [],
        },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Do the thing")).toBeInTheDocument(),
    );
    expect(screen.getByText("pending")).toBeInTheDocument();
  });
});
