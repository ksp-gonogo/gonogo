import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import smallCareerDetail from "./__fixtures__/small-career-detail.json";
import { ContractManagerComponent } from "./index";

/**
 * ContractManager's behavior-preservation golden dual-run
 * (mirrors `Strategies/dual-run.test.tsx`): the SAME contract state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`. `contracts.active`/
 * `contracts.offered`/`contracts.completedRecent` (->
 * `career.status.contracts.active`/`.offered`/`.completedRecent`) are all
 * three migrated reads — `parseContracts`
 * normalizes `agent` -> `agency`/`reputationCompletion` ->
 * `repCompletion`/`dateDeadline` -> `deadlineUt`. `v.altitude` (unrelated to
 * career) stays legacy on both legs; `t.universalTime` is read via
 * `useViewUt()` on both legs too — the stream leg pins the view clock at the
 * fixture's own `t.universalTime` value (`snapshotWidgetMode`, the legacy
 * leg's helper, does the same automatically) so the rendered deadline text
 * matches on both sides rather than an arbitrary stand-in UT. The fixture's
 * `contracts.completedRecent` is empty, so the migration is exercised (both
 * legs genuinely read from their respective sources) without changing the
 * rendered DOM either leg produces. The fixture is `small-career-detail.json`,
 * not any of the other ContractManager fixtures: `career.status.contracts`
 * entries never carry `optional`/`parameterType` on their parameters
 * (career-capture-extend-report.md), and every OTHER fixture sets at least
 * one parameter's `optional: true` or `parameterType`, which the new wire
 * can never reproduce (see that fixture's own `_meta.notes`).
 */
afterEach(() => {
  clearActionHandlers();
});

describe("ContractManager — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same contract state", async () => {
    const mode = { name: "default-6x8", w: 6, h: 8 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: ContractManagerComponent,
      fixture: smallCareerDetail,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      // Matches the fixture's own t.universalTime — see this file's doc
      // comment on why the stream leg can't use an arbitrary stand-in UT
      // any more.
      pinnedUt: smallCareerDetail["t.universalTime"],
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "v.altitude" }],
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "cm-dual" }}>
          <ContractManagerComponent id="cm-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("v.altitude", smallCareerDetail["v.altitude"]);

      const wireActive = smallCareerDetail["contracts.active"].map((c) => {
        const { agency, repCompletion, deadlineUt, ...rest } = c;
        return {
          ...rest,
          agent: agency,
          reputationCompletion: repCompletion,
          dateDeadline: deadlineUt,
        };
      });
      const wireOffered = smallCareerDetail["contracts.offered"].map((c) => {
        const { agency, repCompletion, deadlineUt, ...rest } = c;
        return {
          ...rest,
          agent: agency,
          reputationCompletion: repCompletion,
          dateDeadline: deadlineUt,
        };
      });
      const wireCompletedRecent = smallCareerDetail[
        "contracts.completedRecent"
      ].map((c) => {
        const { agency, repCompletion, deadlineUt, ...rest } = c;
        return {
          ...rest,
          agent: agency,
          reputationCompletion: repCompletion,
          dateDeadline: deadlineUt,
        };
      });
      streamFixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: {
          active: wireActive,
          offered: wireOffered,
          completedRecent: wireCompletedRecent,
        },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("Rescue Kerbal from orbit")) {
        throw new Error("stream leg has not rendered contracts yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
