import { clearAugments, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ObjectivesComponent } from "./index";

/**
 * What this widget does when `career.status` stops being current: it KEEPS the
 * objective list, and this file is what stops that being quietly reversed.
 *
 * An objective list is a set of facts. A contract parameter goes from Incomplete
 * to Complete because something HAPPENED, and nothing happens down a link that
 * has stopped delivering, so the last list we were sent is still what the
 * programme is trying to achieve. The alternative is worse than useless: this
 * frame's only other rendering is "No active objectives", a positive claim about
 * the career, so withholding would have a quiet link read as a mission with
 * nothing left to do.
 *
 * The empty state is also what a withheld list would look like from outside,
 * which is exactly why the assertions below are about what is still on screen
 * rather than about the absence of an error.
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
    carriedChannels: ["career.status"],
    pinnedUt: 10,
  });
}

function emitObjectives(fixture: ReturnType<typeof setupStreamFixture>): void {
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
            parameters: [
              { title: "Reach the Mun", state: "Complete" },
              { title: "Return home safely", state: "Incomplete" },
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

describe("Objectives when career telemetry is no longer current", () => {
  it("keeps the list, its per-objective states, and does not fall back to the empty state", async () => {
    const fixture = newFixture();
    mount(fixture);
    emitObjectives(fixture);
    await waitFor(() =>
      expect(screen.getByRole("list", { name: "Objectives" })).toBeTruthy(),
    );

    goStale(fixture);

    expect(screen.getByText("Reach the Mun")).toBeInTheDocument();
    expect(screen.getByText("Return home safely")).toBeInTheDocument();
    // The reached/pending split survives too. Each of those is an event on the
    // record, not a quantity that decayed between frames, so holding it makes no
    // claim the link cannot support.
    expect(screen.getByText("reached")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    // The list itself is what says the source still yielded content: the frame's
    // "No active objectives" fallback is hidden by an `:empty` sibling CSS rule
    // rather than unmounted, and jsdom does not evaluate that rule, so its
    // presence in the DOM is not evidence of what is on screen either way.
    expect(
      screen.getByRole("list", { name: "Objectives" }).children,
    ).toHaveLength(2);
  });

  it("still says there are no objectives when none ever arrived", async () => {
    // The control for the sentence above: that empty state belongs to a career
    // we have heard nothing about, and it must not become the rendering for a
    // link that stopped after telling us plenty.
    const fixture = newFixture();
    mount(fixture);
    goStale(fixture);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "No active objectives",
      ),
    );
    expect(screen.queryByRole("list", { name: "Objectives" })).toBeNull();
  });
});
