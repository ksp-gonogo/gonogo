import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import smallCareerDetail from "./__fixtures__/small-career-detail.json";
import { ContractManagerComponent } from "./index";

/**
 * ContractManager rendering the real `small-career-detail` fixture through the
 * stream pipeline, with the view clock pinned at the fixture's own UT so the
 * deadline text is realistic. It is the one fixture whose parameters carry no
 * `optional`/`parameterType`, which the wire cannot reproduce.
 */
afterEach(() => {
  clearActionHandlers();
});

describe("ContractManager: real recorded-fixture render off the stream (delay=0)", () => {
  it("renders the small-career-detail contracts off the stream", async () => {
    const mode = { name: "default-6x8", w: 6, h: 8 };

    const streamFixture = setupStreamFixture({
      pinnedUt: smallCareerDetail["t.universalTime"],
      suspendFrames: true,
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
      if (!visibleText(container).includes("Rescue Kerbal from orbit")) {
        throw new Error("stream leg has not rendered contracts yet");
      }
    });

    expect(
      screen.getByText(/Rescue Kerbal from orbit of Kerbin/i),
    ).toBeInTheDocument();
  });
});
