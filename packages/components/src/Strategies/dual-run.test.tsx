import { DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import smallCareerDetail from "./__fixtures__/small-career-detail.json";
import { StrategiesComponent } from "./index";

/**
 * Strategies's M3/M3b career batch behavior-preservation golden dual-run
 * (mirrors `SpaceCenterStatus/dual-run.test.tsx`): the SAME career state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`. `career.funds`/`reputation`/
 * `science` AND `strategies.all` (-> `career.status.strategies.all`, M3b
 * career-detail batch) are all migrated now. The fixture is
 * `small-career-detail.json`, not `one-active-room-for-more.json` (still
 * used by the legacy-only `snapshots.test.tsx`): `career.status.
 * strategies.all` never carries `effectiveCostReputation` (no cheap
 * decompiled source for KSP's nonlinear rep curve — career-capture-extend-
 * report.md) and `parseStrategies` falls back to `initialCostReputation`
 * when it's absent, so a byte-identical comparison needs a legacy fixture
 * where `effectiveCostReputation` already equals `initialCostReputation`
 * on every entry (see that fixture's own `_meta.notes`). `departmentName`
 * -> `department` is the one field rename `parseStrategies` normalizes.
 */
afterEach(() => {
  cleanup();
});

describe("Strategies — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same career state", async () => {
    const mode = { name: "wide-9x12", w: 9, h: 12 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: StrategiesComponent,
      fixture: smallCareerDetail,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "strats-dual" }}>
          <StrategiesComponent id="strats-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      const wireStrategies = smallCareerDetail["strategies.all"].map((s) => {
        const { departmentName, effectiveCostReputation, ...rest } = s;
        return { ...rest, department: departmentName };
      });
      streamFixture.emit("career.status", {
        economy: {
          funds: smallCareerDetail["career.funds"],
          reputation: smallCareerDetail["career.reputation"],
          science: smallCareerDetail["career.science"],
        },
        facilities: null,
        contracts: null,
        strategies: {
          active: wireStrategies.filter((s) => s.isActive),
          all: wireStrategies,
          activeCount: wireStrategies.filter((s) => s.isActive).length,
        },
        tech: null,
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("525,000f")) {
        throw new Error("stream leg has not rendered funds yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);

    expect(streamHtml).toBe(legacyHtml);
  });
});
