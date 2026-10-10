import {
  ContributionsProvider,
  clearContributions,
  registerContribution,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import type { PlotEntry } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { heldWord } from "@ksp-gonogo/ui-kit";
import { beforeEach, describe, expect, it } from "vitest";
import { MIN_PLOT_PX, PlotBoard, type PlotSlot, plotGrid } from "./PlotBoard";

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

const RESERVE: PlotSlot[] = [
  { subject: "first", title: "First", note: "Awaiting data" },
  { subject: "second", title: "Second", note: "Awaiting data" },
];

function ReservingHost() {
  return (
    <WidgetMetaContext.Provider
      value={{ componentId: "host-widget", contributionSlots: ["plots"] }}
    >
      <ContributionsProvider>
        <PlotBoard reserve={RESERVE} />
      </ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}

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

  it("marks a plot held while any contribution to its subject is drawn from a held reading", async () => {
    registerContribution({
      id: "framer",
      contributes: "plots",
      compute: () => [
        {
          subject: "shared",
          title: "Shared plot",
          frame: FRAME,
          layers: ONE_MARK,
          held: {
            state: "observed" as const,
            value: undefined,
            reckoning: { status: "none" as const },
          },
        },
      ],
    });
    registerContribution({
      id: "enricher",
      contributes: "plots",
      compute: () => [
        { subject: "shared", layers: ONE_MARK, held: "disconnected" as const },
      ],
    });

    render(<Host />);

    await waitFor(() => expect(screen.getByText("Shared plot")).toBeTruthy());
    expect(screen.getByText(heldWord("disconnected"))).toBeTruthy();
    await act(async () => {});
  });

  it("keeps a plot's heading on one line when a held badge joins it, so the plot under it never moves down", async () => {
    registerContribution({
      id: "held-plot",
      contributes: "plots",
      compute: () => [
        {
          subject: "held",
          title: "A long plot title",
          frame: FRAME,
          layers: ONE_MARK,
          held: "disconnected" as const,
        },
      ],
    });

    render(<Host />);

    const title = await screen.findByText("A long plot title");
    expect(title.style.whiteSpace).toBe("nowrap");
    expect(title.style.textOverflow).toBe("ellipsis");
    await act(async () => {});
  });

  it("draws no held badge on a plot every contribution draws from current readings", async () => {
    registerContribution({
      id: "current-plot",
      contributes: "plots",
      compute: () => [
        {
          subject: "current",
          title: "Current plot",
          frame: FRAME,
          layers: ONE_MARK,
          held: {
            state: "observed" as const,
            value: undefined,
            reckoning: { status: "none" as const },
          },
        },
      ],
    });

    render(<Host />);

    await waitFor(() => expect(screen.getByText("Current plot")).toBeTruthy());
    expect(screen.queryByText(heldWord("disconnected"))).toBeNull();
    expect(screen.queryByText(heldWord("held"))).toBeNull();
    await act(async () => {});
  });
});

describe("the board's layout", () => {
  const GAP = 8;

  it("puts every plot side by side while each stays legible, all the same size", () => {
    const grid = plotGrid(3, 438, GAP);
    expect(grid.columns).toBe(3);
    expect(3 * grid.side + 2 * GAP).toBeLessThanOrEqual(438);
    expect(grid.side).toBeGreaterThanOrEqual(MIN_PLOT_PX);
  });

  it("shrinks the plots with the board, rather than holding a width that overflows it", () => {
    const wide = plotGrid(3, 900, GAP).side;
    const narrow = plotGrid(3, 420, GAP).side;
    expect(narrow).toBeLessThan(wide);
    expect(plotGrid(3, 420, GAP).columns).toBe(3);
  });

  it("wraps when the board is too narrow for them all, and a plot on a row of its own is no larger than the rest", () => {
    const grid = plotGrid(3, 300, GAP);
    expect(grid.columns).toBe(2);
    // One side for every plot: the third, alone on its row, is drawn at the same size.
    expect(2 * grid.side + GAP).toBeLessThanOrEqual(300);
  });

  it("shrinks the plots to the height a short tile gives them, down to the legible minimum", () => {
    const free = plotGrid(3, 900, GAP).side;
    const short = plotGrid(3, 900, GAP, 200).side;
    expect(short).toBeLessThan(free);
    expect(short).toBeGreaterThanOrEqual(MIN_PLOT_PX);
    expect(plotGrid(3, 900, GAP, 40).side).toBe(MIN_PLOT_PX);
  });

  it("never draws a plot wider than the board itself", () => {
    expect(plotGrid(1, 90, GAP).side).toBeLessThanOrEqual(90);
  });

  describe("reserved slots", () => {
    it("keeps a heading and frame for every reserved plot while none has anything to draw", () => {
      render(<ReservingHost />);
      expect(screen.getByText("First")).toBeInTheDocument();
      expect(screen.getByText("Second")).toBeInTheDocument();
    });

    it("fills a slot in place when its plot arrives, leaving the other where it was", async () => {
      registerContribution({
        id: "second-plot",
        contributes: "plots",
        compute: () => [
          {
            subject: "second",
            title: "Second",
            frame: FRAME,
            layers: ONE_MARK,
          },
        ],
      });
      render(<ReservingHost />);
      await act(async () => {});
      const headings = screen
        .getAllByText(/^(First|Second)$/)
        .map((h) => h.textContent);
      expect(headings).toEqual(["First", "Second"]);
    });
  });
});
