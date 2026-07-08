import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import earlyCareer from "./__fixtures__/early-career-63-nodes.json";
import { TechTreeComponent } from "./index";

/**
 * TechTree's M3 career batch behavior-preservation golden dual-run (mirrors
 * `Strategies/dual-run.test.tsx`): the SAME tech-tree state, rendered once
 * off the legacy `DataSource` and once off the stream, must produce
 * byte-identical DOM at `delay=0`. `career.science` is the only migrated
 * field — `tech.nodes`/`kc.scene` stay legacy on both legs.
 */
afterEach(() => {
  cleanup();
});

describe("TechTree — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same tech-tree state", async () => {
    const mode = { name: "default-6x9", w: 6, h: 9 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: TechTreeComponent,
      fixture: earlyCareer,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "tech.nodes" }, { key: "kc.scene" }],
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "tt-dual" }}>
          <TechTreeComponent id="tt-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("tech.nodes", earlyCareer["tech.nodes"]);
      legacyAux.source.emit("kc.scene", earlyCareer["kc.scene"]);
      streamFixture.emit("career.status", {
        economy: {
          funds: 0,
          reputation: 0,
          science: earlyCareer["career.science"],
        },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("4854 sci")) {
        throw new Error("stream leg has not rendered science yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
