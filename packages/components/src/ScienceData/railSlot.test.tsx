import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { railTagsForTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { DelayRailProvider, useRailEntry } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ScienceDataComponent } from "./index";

const RIBBON_LABEL = "Mystery Goo transferring to the ground";

/** A stand-in for an Uplink augment that contributes a continuous rail entry for its row's subject. */
function makeRailAugment(oneWaySeconds: number | null) {
  return function RailAugment({ subjectId }: { subjectId: string }) {
    useRailEntry({
      inFlight: [],
      tags: railTagsForTelemetry("continuous"),
      effectiveDelaySeconds: oneWaySeconds,
      ariaLabel: RIBBON_LABEL,
      ribbons: [
        {
          id: `test.transfer.${subjectId}`,
          label: RIBBON_LABEL,
          oneWaySeconds,
          amplitudes: [0.4, 0.6, 0.5, 0.7],
          tags: railTagsForTelemetry("continuous"),
        },
      ],
    });
    return null;
  };
}

const renderedTrees: Array<() => void> = [];

async function renderHost(oneWaySeconds: number | null) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  const { unmount } = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "science-data", contributionSlots: [] }}
      >
        <DelayRailProvider>
          <DashboardItemContext.Provider value={{ instanceId: "sci" }}>
            <ScienceDataComponent config={{}} id="sci" w={8} h={10} />
          </DashboardItemContext.Provider>
        </DelayRailProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  act(() => {
    registerAugment({
      id: "test-rail-augment",
      augments: "science-data.aboard-row",
      component: makeRailAugment(oneWaySeconds),
    });
    fixture.emit("science.experimentBreakdown", [
      {
        subjectId: "mysteryGoo@MunSrfLandedMidlands",
        biome: "Midlands",
        situation: "SrfLanded",
        expTitle: "Mystery Goo Observation",
        dataMits: 8,
        remainingPotential: 12.5,
      },
    ]);
  });
  await waitFor(() =>
    expect(screen.getByText(/Mystery Goo Observation/)).toBeInTheDocument(),
  );
}

describe("ScienceData: a rail entry contributed by an aboard-row augment", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearAugments();
  });

  it("draws the ribbon on the host panel's delay rail when the link has delay", async () => {
    await renderHost(4);
    await waitFor(() =>
      expect(screen.getByLabelText(RIBBON_LABEL)).toBeInTheDocument(),
    );
  });

  it("draws nothing while the one-way delay is unread", async () => {
    await renderHost(null);
    await act(async () => {});
    expect(screen.queryByLabelText(RIBBON_LABEL)).not.toBeInTheDocument();
  });
});
