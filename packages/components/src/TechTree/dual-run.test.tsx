import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import smallCareerDetail from "./__fixtures__/small-career-detail.json";
import { TechTreeComponent } from "./index";

/**
 * TechTree's M3/M3b career batch behavior-preservation golden dual-run
 * (mirrors `Strategies/dual-run.test.tsx`): the SAME tech-tree state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`. `career.science` AND
 * `tech.nodes` (-> `career.status.tech.nodes`) are both migrated as of the
 * M3b career-detail batch — the fixture is
 * `small-career-detail.json`, not the rich `early-career-63-nodes.json`
 * (still used by the legacy-only `index.test.tsx`): `career.status.
 * tech.nodes` (CareerViewProvider.BuildTechNodes) has no description/parts
 * field at all, so a byte-identical comparison needs a legacy fixture that
 * already omits them (see that fixture's own `_meta.notes`). `kc.scene`
 * (-> `spaceCenter.scene.scene`) is migrated too as of the P4a shared-map
 * batch — the legacy leg still reads it off the plain `DataSource` (that
 * leg never mounts a `TelemetryProvider`, so the shim's carried-channels
 * gate keeps it on the legacy path there); the stream leg now feeds it
 * through the fixture's `spaceCenter.scene` topic instead of a legacy AUX
 * `DataSource`.
 */
afterEach(() => {
  cleanup();
});

describe("TechTree — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same tech-tree state", async () => {
    const mode = { name: "default-6x9", w: 6, h: 9 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: TechTreeComponent,
      fixture: smallCareerDetail,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["career.status", "spaceCenter.scene"],
      pinnedUt: 10,
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
            scienceCost: n.scienceCost,
            unlocked: n.state === "Available",
            parents: n.parents,
          })),
        },
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("4854 sci")) {
        throw new Error("stream leg has not rendered science yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);

    expect(streamHtml).toBe(legacyHtml);
  });
});
