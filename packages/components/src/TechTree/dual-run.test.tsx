import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import smallCareerDetail from "./__fixtures__/small-career-detail.json";
import { TechTreeComponent } from "./index";

/**
 * Renders a small hand-authored tech tree (5 nodes, one multi-parent, 3 unlocked) through the stream pipeline in the real wire shape, including each node's `description`.
 */
describe("TechTree: real small career-detail fixture render off the stream (delay=0)", () => {
  it("renders science, unlocked/researchable counts, and every node off the stream, no legacy leg", async () => {
    const mode = { name: "default-6x9", w: 6, h: 9 };

    const streamFixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tt-dual" }}>
          <TechTreeComponent id="tt-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit("career.status", {
        balances: {
          funds: 0,
          reputation: 0,
          science: smallCareerDetail["career.science"],
        },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: {
          unlockedCount: 3,
          unlockedIds: ["basicRocketry", "engineering101", "survivability"],
          nodes: smallCareerDetail["tech.nodes"].map((n) => ({
            id: n.id,
            title: n.title,
            description: n.description,
            scienceCost: n.scienceCost,
            unlocked: n.state === "Available",
            parents: n.parents,
          })),
        },
      });
    });

    await waitFor(() => {
      // Science reads as a glyph rather than a "sci" suffix, so the number is all a sighted reader sees.
      if (!visibleText(container).includes("4854")) {
        throw new Error("stream leg has not rendered science yet");
      }
    });
    expect(container.textContent).toContain("4854 science");

    // 3 unlocked and 2 researchable-now (parents unlocked, affordable at 4854): every fixture node rendered.
    expect(
      screen.getByText(/3\/5 unlocked · 2 researchable/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Basic Rocketry")).toBeInTheDocument();
    expect(screen.getByText("General Rocketry")).toBeInTheDocument();
    expect(screen.getByText("Survivability")).toBeInTheDocument();
    expect(screen.getByText("Advanced Rocketry")).toBeInTheDocument();
    expect(screen.getByText("Stability")).toBeInTheDocument();
  });

  it("shows a node's description, carried by the wire shape and not the legacy one", async () => {
    const user = userEvent.setup();
    const streamFixture = setupStreamFixture({
      pinnedUt: 10,
    });

    render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tt-desc" }}>
          <TechTreeComponent id="tt-desc" w={6} h={9} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit(
        "career.status",
        smallCareerDetail._stream.emits[1].value,
      );
    });

    await waitFor(() =>
      expect(screen.getByText("Basic Rocketry")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Basic Rocketry"));
    expect(
      screen.getByText("How hard can Rocket Science be anyway?"),
    ).toBeInTheDocument();
  });
});
