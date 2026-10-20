import { clearAugments, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ObjectivesComponent } from "./index";

/**
 * Proves the objective list is kept when `career.status` stops being current: it changes only on events.
 * Withholding it would render "No active objectives", a claim about the career rather than the link.
 */

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearAugments();
});

function mount(fixture: ReturnType<typeof setupStreamFixture>) {
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "obj-stale" }}>
        <ObjectivesComponent config={{}} id="obj-stale" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

function newFixture() {
  return setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function emitObjectives(fixture: ReturnType<typeof setupStreamFixture>): void {
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
            parameters: [
              { title: "Reach the Mun", state: "Complete", stateOrdinal: 1 },
              {
                title: "Return home safely",
                state: "Incomplete",
                stateOrdinal: 0,
              },
            ],
          },
        ],
        offered: [],
      },
      strategies: null,
      tech: null,
    });
  });
}

/** Drop the link, then run a frame: nothing else re-derives the readings. */
function goStale(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("Objectives when career telemetry is held", () => {
  it("keeps the list, its per-objective states, marks each state held, and does not fall back to the empty state", async () => {
    const fixture = newFixture();
    mount(fixture);
    emitObjectives(fixture);
    await waitFor(() =>
      expect(screen.getByRole("list", { name: "Objectives" })).toBeTruthy(),
    );

    const list = () => screen.getByRole("list", { name: "Objectives" });
    // Held is marked on each objective's state, and not while the board is current.
    expect(list().querySelectorAll("[data-held-mark]")).toHaveLength(0);

    goStale(fixture);

    expect(list().querySelectorAll("[data-held-mark]")).toHaveLength(2);
    expect(screen.queryByText("OFFLINE")).toBeNull();
    expect(screen.getByText("Reach the Mun")).toBeInTheDocument();
    expect(screen.getByText("Return home safely")).toBeInTheDocument();
    expect(screen.getByText("reached")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    // The fallback is hidden by a CSS rule jsdom does not evaluate, so the list is the evidence.
    expect(list().children).toHaveLength(2);
  });

  it("still says it is awaiting contract data when none ever arrived", async () => {
    const fixture = newFixture();
    mount(fixture);
    goStale(fixture);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Awaiting contract data",
      ),
    );
    expect(screen.queryByRole("list", { name: "Objectives" })).toBeNull();
  });
});
