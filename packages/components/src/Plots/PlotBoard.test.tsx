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
 * What the arranger does with what it is handed, and the two things it must not
 * do with it.
 *
 * The contributions go in through the REAL registry rather than a stubbed hook:
 * the questions here are about the slot being global and about an entry with
 * nothing on it, and both of those are answered by the registry and the
 * aggregation rather than by this component alone.
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

// `beforeEach` only, deliberately. Two tests below register the same id, so a
// clear between them is load-bearing; an `afterEach` one is not, and it clears
// the registry while the tree is still mounted, so every `useSyncExternalStore`
// subscriber re-renders outside `act` (CLAUDE.md's third cause). RTL's own
// auto-cleanup has already unmounted by the time the next `beforeEach` runs.
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

    // The contributor wrote `plots`, never `host-widget.plots`, and the widget
    // hosting it is one it has never heard of.
    await waitFor(() => expect(screen.getByText("Guest plot")).toBeTruthy());
    await act(async () => {});
  });

  /**
   * The absence case, and the reason it is a test rather than a comment: the
   * shape a layerless plot renders as is not blank. `GraphView` draws its frame,
   * pins the axes it was given and lays "Configure series to begin graphing."
   * across the middle, so the failure mode is a complete-looking instrument
   * saying nothing, which reads as "nothing is happening" rather than "nothing
   * is known".
   */
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
      // Relevance, the only route there is: not now, for whatever reason the
      // plot's own subject gives it.
      compute: () => null,
    });

    const { container } = render(<Host />);

    await act(async () => {});
    expect(container.textContent).toBe("");
  });
});
