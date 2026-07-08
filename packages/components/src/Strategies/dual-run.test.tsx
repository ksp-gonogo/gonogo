import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import oneActive from "./__fixtures__/one-active-room-for-more.json";
import { StrategiesComponent } from "./index";

/**
 * Strategies's M3 career batch behavior-preservation golden dual-run
 * (mirrors `SpaceCenterStatus/dual-run.test.tsx`): the SAME career state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`. `career.funds`/`reputation`/
 * `science` are the only migrated fields — `strategies.all` stays legacy on
 * both legs.
 */
afterEach(() => {
  cleanup();
});

describe("Strategies — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same career state", async () => {
    const mode = { name: "wide-9x12", w: 9, h: 12 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: StrategiesComponent,
      fixture: oneActive,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "strategies.all" }],
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "strats-dual" }}>
          <StrategiesComponent id="strats-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("strategies.all", oneActive["strategies.all"]);
      streamFixture.emit("career.status", {
        economy: {
          funds: oneActive["career.funds"],
          reputation: oneActive["career.reputation"],
          science: oneActive["career.science"],
        },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("289,848f")) {
        throw new Error("stream leg has not rendered funds yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
