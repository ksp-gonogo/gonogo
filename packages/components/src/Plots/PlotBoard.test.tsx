import {
  ContributionsProvider,
  clearContributions,
  registerContribution,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import type { PlotEntry } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { PlotBoard } from "./PlotBoard";

/**
 * What the arranger does with what it is handed, through the real registry,
 * since slot globality and empty entries are the registry's and aggregation's
 * answers, not this component's alone.
 */

const FRAME: PlotEntry["frame"] = {
  xDomain: [0, 100],
  xUnit: "m/s",
  yDomain: [0, 1000],
  yUnit: "m",
};

const ONE_MARK: PlotEntry["layers"] = [
  { kind: "rule", id: "ceiling", along: "y", value: 500, label: "ceiling" },
];

function Host({ componentId = "host-widget" }: { componentId?: string }) {
  return (
    <WidgetMetaContext.Provider
      value={{ componentId, contributionSlots: ["plots"] }}
    >
      <ContributionsProvider>
        <PlotBoard />
      </ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}

// `beforeEach` only: two tests register the same id, and an `afterEach` clear would notify a still-mounted tree outside `act`.
beforeEach(() => {
  clearContributions();
});

describe("PlotBoard", () => {
  it("draws a plot contributed to the app-wide slot, which names no host", async () => {
    registerContribution({
      id: "guest-plot",
      contributes: "plots",
      compute: () => [
        {
          subject: "guest",
          title: "Guest plot",
          frame: FRAME,
          layers: ONE_MARK,
        },
      ],
    });

    render(<Host />);

    // The contributor wrote `plots`, and the hosting widget is one it has never heard of.
    await waitFor(() => expect(screen.getByText("Guest plot")).toBeTruthy());
    await act(async () => {});
  });

  // A layerless plot would render a framed, captioned instrument saying nothing, which reads as "nothing is happening" rather than "nothing is known".
  it("renders nothing at all for a plot with no layers", async () => {
    registerContribution({
      id: "silent-plot",
      contributes: "plots",
      compute: () => [
        { subject: "silent", title: "Silent plot", frame: FRAME, layers: [] },
      ],
    });

    const { container } = render(<Host />);

    await act(async () => {});
    expect(screen.queryByText("Silent plot")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("keeps the drawable plots when a sibling contributes nothing to draw", async () => {
    registerContribution({
      id: "silent-plot",
      contributes: "plots",
      compute: () => [
        { subject: "silent", title: "Silent plot", frame: FRAME, layers: [] },
      ],
    });
    registerContribution({
      id: "loud-plot",
      contributes: "plots",
      compute: () => [
        { subject: "loud", title: "Loud plot", frame: FRAME, layers: ONE_MARK },
      ],
    });

    render(<Host />);

    await waitFor(() => expect(screen.getByText("Loud plot")).toBeTruthy());
    expect(screen.queryByText("Silent plot")).toBeNull();
    await act(async () => {});
  });

  it("renders nothing when the plot declines to contribute itself", async () => {
    registerContribution({
      id: "irrelevant-plot",
      contributes: "plots",
      // Not relevant now: the only route to no plot.
      compute: () => null,
    });

    const { container } = render(<Host />);

    await act(async () => {});
    expect(container.textContent).toBe("");
  });
});
