import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import smallCareerDetail from "./__fixtures__/small-career-detail.json";
import { ContractManagerComponent } from "./index";

/**
 * ContractManager's real recorded-fixture render off the stream.
 *
 * `contracts.active`/`.offered`/`.completedRecent` all read off the
 * `career.status` Topic's `contracts` sub-tree now (canonical `useTelemetry`),
 * with `parseContracts` normalizing `agent` -> `agency` /
 * `reputationCompletion` -> `repCompletion` / `dateDeadline` -> `deadlineUt`.
 * The original version of this test rendered the same contract state once off a
 * legacy `DataSource` (`snapshotWidgetMode`, which mounts no
 * `TelemetryProvider`) and once off the stream and asserted byte-identical DOM;
 * that comparison is no longer possible — the legacy leg now renders nothing but
 * "Awaiting contract telemetry" since the reads are stream-only. Same cause
 * (full stream migration, not a test bug) as every other widget's
 * `dual-run.test.tsx` dropping its now-impossible legacy leg.
 *
 * What remains, and is still worth its own file: the real
 * `small-career-detail` fixture run genuinely through the stream pipeline, with
 * the view clock pinned at the fixture's own `t.universalTime` so the rendered
 * deadline text is realistic. `small-career-detail.json` is used (not the other
 * ContractManager fixtures) because `career.status.contracts` entries never
 * carry `optional`/`parameterType` on their parameters
 * (career-capture-extend-report.md), and every other fixture sets at least one,
 * which the wire can't reproduce.
 */
afterEach(() => {
  clearActionHandlers();
});

describe("ContractManager — real recorded-fixture render off the stream (delay=0)", () => {
  it("renders the small-career-detail contracts off the stream", async () => {
    const mode = { name: "default-6x8", w: 6, h: 8 };

    const streamFixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: smallCareerDetail["t.universalTime"],
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "cm-dual" }}>
          <ContractManagerComponent id="cm-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      const toWire = (c: Record<string, unknown>) => {
        const { agency, repCompletion, deadlineUt, ...rest } = c;
        return {
          ...rest,
          agent: agency,
          reputationCompletion: repCompletion,
          dateDeadline: deadlineUt,
        };
      };
      streamFixture.emit("career.status", {
        economy: null,
        facilities: null,
        contracts: {
          active: smallCareerDetail["contracts.active"].map(toWire),
          offered: smallCareerDetail["contracts.offered"].map(toWire),
          completedRecent:
            smallCareerDetail["contracts.completedRecent"].map(toWire),
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

    expect(
      screen.getByText(/Rescue Kerbal from orbit of Kerbin/i),
    ).toBeInTheDocument();
  });
});
