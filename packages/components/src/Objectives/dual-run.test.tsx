import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import contractsOnly from "./__fixtures__/contracts-only.json";
import { ObjectivesComponent } from "./index";

/**
 * Objectives's M3b career-detail behavior-preservation golden dual-run
 * (mirrors `ContractManager/dual-run.test.tsx`): the SAME contract state,
 * rendered once off the legacy `DataSource` and once off the stream, must
 * produce byte-identical DOM at `delay=0`. `contracts.active` (->
 * `career.status.contracts.active`, consumed via the shared
 * `parseContracts`/`contractObjectives` from `../ContractManager`) is the
 * one migrated read — `mh.*` (no mission running in this fixture) stays
 * legacy. `contracts-only.json` was reusable as-is (unlike ContractManager's
 * own dual-run fixture): every parameter already sets `optional: false`,
 * so there is no `optional`/`parameterType` divergence between the legacy
 * and new-wire shapes to work around here.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("Objectives — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same contract state", async () => {
    const mode = { name: "default-5x8", w: 5, h: 8 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: ObjectivesComponent,
      fixture: contractsOnly,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["career.status"],
      pinnedUt: 10,
    });
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "mh.available" }],
      connectSource: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "obj-dual" }}>
          <ObjectivesComponent id="obj-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("mh.available", contractsOnly["mh.available"]);

      const wireActive = contractsOnly["contracts.active"].map((c) => {
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
        contracts: { active: wireActive, offered: [] },
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() => {
      if (!container.textContent?.includes("Test LV-909: Flying over Kerbin")) {
        throw new Error("stream leg has not rendered objectives yet");
      }
    });

    const streamHtml = stripVolatile(container.innerHTML);
    teardownMockDataSource(legacyAux);

    expect(streamHtml).toBe(legacyHtml);
  });
});
