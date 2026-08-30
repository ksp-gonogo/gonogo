import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import smallCareerDetail from "./__fixtures__/small-career-detail.json";
import { TechTreeComponent } from "./index";

/**
 * TechTree's reads (`index.tsx`: `useTelemetry("career.status")?.tech
 * ?.nodes`, `?.economy?.science`, and `useTelemetry("spaceCenter.scene")
 * ?.scene`) are ALL ONE-ARG canonical reads now, none of them has a
 * legacy fallback at all. The original version of this test rendered the
 * SAME tech-tree state once off a legacy `DataSource` (`snapshotWidgetMode`,
 * which mounts no `TelemetryProvider`) and once off the stream, asserting
 * byte-identical DOM; that comparison is no longer possible, the legacy
 * leg now renders nothing but "Awaiting tech telemetry", since every one
 * of its reads is stream-only. Same underlying cause (full canonical
 * migration, not a test bug) as `ScienceBench`/`ScienceOfficer`/
 * `SpaceCenterStatus`/`TargetPicker`'s own `dual-run.test.tsx` files
 * dropping their now-impossible legacy legs.
 *
 * What remains, and is still worth its own file: the small hand-authored
 * tech-tree fixture (5 nodes, a multi-parent node, 3 unlocked), run
 * genuinely through the stream pipeline in the shape the real wire
 * actually sends. `career.status.tech.nodes` (CareerViewProvider
 * .BuildTechNodes) carries a `description` as of contract 14.1, so the
 * node body's description line is exercised here off the wire; `parts` is
 * still absent from it, so the per-node part detail stays the preserve of
 * `index.test.tsx`'s rich `early-career-63-nodes.json`.
 */
describe("TechTree: real small career-detail fixture render off the stream (delay=0)", () => {
  it("renders science, unlocked/researchable counts, and every node off the stream, no legacy leg", async () => {
    const mode = { name: "default-6x9", w: 6, h: 9 };

    const streamFixture = setupStreamFixture({
      carriedChannels: ["career.status", "spaceCenter.scene"],
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
      streamFixture.emit("spaceCenter.scene", {
        scene: smallCareerDetail["kc.scene"],
      });
      streamFixture.emit("career.status", {
        economy: {
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
      // Science reads as a microscope glyph rather than a "sci" suffix, so
      // the number is the whole of what a sighted reader sees and the word
      // rides the hidden label beside it.
      if (!visibleText(container).includes("4854")) {
        throw new Error("stream leg has not rendered science yet");
      }
    });
    expect(container.textContent).toContain("4854 science");

    // 3 unlocked (basicRocketry/engineering101/survivability), 2
    // researchable-now (advRocketry/stability, both parent-unlocked and
    // affordable at 4854 sci): every node from the fixture rendered.
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
      carriedChannels: ["career.status", "spaceCenter.scene"],
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
      streamFixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
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
