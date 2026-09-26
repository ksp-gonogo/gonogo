import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ReadingProbe } from "../test/ReadingProbe";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { ObjectivesComponent } from "./index";

/**
 * Characterisation: pins what Objectives does today when its one read is `undefined`, not what it should do.
 * Never arrived, tombstoned, a null `contracts` sub-tree and `active: []` all render "No active objectives".
 */

function newFixture() {
  return setupStreamFixture({
    carriedChannels: ["career.status"],
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function renderObjectives(
  fixture: StreamFixture,
  { probe = false }: { probe?: boolean } = {},
) {
  return render(
    <fixture.Provider>
      {probe && <ReadingProbe topic="career.status" />}
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

    // A cold topic is reported as a confident absence.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No active objectives");
    expect(objectivesList()).toBeNull();
  });
});

describe("Objectives: the absence gates around `contracts.active`", () => {
  it("renders identically for a never-arrived topic and for a confirmed-empty active list", async () => {
    const fixture = newFixture();
    renderObjectives(fixture, { probe: true });

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

    await screen.findByText("career.status: observed");
    // "No active contracts" and "heard nothing" produce the same DOM.
    expect(screen.getByRole("status").textContent).toBe(beforeAnything);
    expect(objectivesList()).toBeNull();
  });

  it("fires the `?? []` coercion when the arrived record's `contracts` is null", async () => {
    const fixture = newFixture();
    renderObjectives(fixture, { probe: true });

    act(() => {
      fixture.emit("career.status", {
        economy: { funds: 1000, reputation: 0, science: 0 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await screen.findByText("career.status: observed");
    expect(screen.getByRole("status")).toHaveTextContent(
      "No active objectives",
    );
    expect(objectivesList()).toBeNull();
  });

  it("fires the `?? []` coercion when `contracts.active` itself is null", async () => {
    const fixture = newFixture();
    renderObjectives(fixture, { probe: true });

    act(() => {
      fixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: { active: null, offered: [] },
        strategies: null,
        tech: null,
      });
    });

    await screen.findByText("career.status: observed");
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
    renderObjectives(fixture, { probe: true });

    act(() => {
      // A tombstone is `null`, not `undefined`, but lands on the same empty state.
      fixture.emit("career.status", null);
    });

    await screen.findByText("career.status: absent");
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
      // A missing agency is filled with a generic word rather than marked unknown.
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
