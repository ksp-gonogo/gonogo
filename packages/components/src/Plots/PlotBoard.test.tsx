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
import { PlotBoard, type PlotSlot, plotRowWidth } from "./PlotBoard";

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
  it("draws every plot in a square cell of one grid, its heading above the square", async () => {
    const { container } = render(<ReservingHost />);

    await act(async () => {});
    const board = container.querySelector<HTMLElement>("[data-plot-board]");
    const cells = board?.querySelectorAll("[data-square-cell]") ?? [];
    expect(cells).toHaveLength(RESERVE.length);
    for (const cell of cells) {
      expect(cell.querySelector("[data-square-heading]")).not.toBeNull();
      expect(cell.querySelector("[data-square]")?.childElementCount).toBe(1);
    }
  });

  it("sizes a single row of plots from the height of the size container it sits in", () => {
    expect(plotRowWidth(3)).toBe(
      "calc(3 * (100cqh - 17px - var(--gap-related)) + 2 * var(--gap-related))",
    );
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
