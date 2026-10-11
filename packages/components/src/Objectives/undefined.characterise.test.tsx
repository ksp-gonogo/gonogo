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
 * Characterisation: pins what Objectives does when its one read is `undefined`.
 * A topic that has never arrived says it is awaiting data; a tombstone, a null `contracts` sub-tree and `active: []` all render "No active objectives".
 */

function newFixture() {
  return setupStreamFixture({
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
  it("says it is awaiting contract data rather than claiming there are no objectives", () => {
    renderObjectives(newFixture());

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Awaiting contract data");
    expect(status).not.toHaveTextContent("No active objectives");
    expect(objectivesList()).toBeNull();
  });
});

describe("Objectives: the absence gates around `contracts.active`", () => {
  it("tells a never-arrived topic from a confirmed-empty active list", async () => {
    const fixture = newFixture();
    renderObjectives(fixture, { probe: true });

    const beforeAnything = screen.getByRole("status").textContent;
    expect(beforeAnything).toContain("Awaiting contract data");

    act(() => {
      fixture.emit("career.status", {
        balances: null,
        facilities: null,
        contracts: { active: [], offered: [] },
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

  it("fires the `?? []` coercion when the arrived record's `contracts` is null", async () => {
    const fixture = newFixture();
    renderObjectives(fixture, { probe: true });

    act(() => {
      fixture.emit("career.status", {
        balances: { funds: 1000, reputation: 0, science: 0 },
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
        balances: null,
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
        balances: null,
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
  it("reads a whole-topic tombstone as a confirmed absence, unlike a topic that never arrived", async () => {
    const fixture = newFixture();
    renderObjectives(fixture, { probe: true });

    act(() => {
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
        balances: null,
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
        balances: null,
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
