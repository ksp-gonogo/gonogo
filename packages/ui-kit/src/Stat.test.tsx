import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ContributionsPanelStore } from "./contributionsRead";
import { NULL_DISPLAY } from "./NullValue";
import { Stat, StatStrip } from "./Stat";
import { StatContributions } from "./StatContributions";
import { Unit } from "./Unit";
import { WidgetMetaContext } from "./WidgetMetaContext";

const SLOT = "astronaut-complex.readouts";

/**
 * Feeds the per-widget contribution store directly, the way `WidgetMeters`'s own
 * suite does: going through the per-frame aggregation would mean standing up a
 * telemetry client to test a renderer.
 */
function WithStats({
  entries,
  children,
}: {
  entries: readonly unknown[];
  children: ReactNode;
}) {
  return (
    <WidgetMetaContext.Provider
      value={{ componentId: "astronaut-complex", contributionSlots: [SLOT] }}
    >
      <ContributionsPanelStore.Provider>
        <Seed entries={entries}>{children}</Seed>
      </ContributionsPanelStore.Provider>
    </WidgetMetaContext.Provider>
  );
}

function Seed({
  entries,
  children,
}: {
  entries: readonly unknown[];
  children: ReactNode;
}) {
  const store = ContributionsPanelStore.useStore();
  if (store && store.getSnapshot().length === 0) {
    store.register({ id: SLOT, entries });
  }
  return <>{children}</>;
}

describe("Stat", () => {
  it("associates the label with the figure rather than leaving them adjacent", () => {
    render(
      <Stat label="Funds">
        <Unit value={value("funds", 289_848)} />
      </Stat>,
    );

    // A description list, so a reader in browse mode gets the pair as one unit.
    const term = screen.getByText("Funds");
    expect(term.tagName).toBe("DT");
    expect(term.closest("dl")).not.toBeNull();
  });

  it("draws the qualifying line only when there is one", () => {
    const { container, rerender } = render(
      <Stat label="In training" detail="across 3 courses">
        4
      </Stat>,
    );
    expect(container.textContent).toContain("across 3 courses");

    rerender(<Stat label="In training">4</Stat>);
    // One `dd` rather than two: an absent detail leaves no empty line behind,
    // which is what would otherwise change the height of every cell beside it.
    expect(container.querySelectorAll("dd")).toHaveLength(1);
  });

  it("passes an a11y smoke check as a strip", async () => {
    const { container } = render(
      <StatStrip>
        <Stat label="Funds">
          <Unit value={value("funds", 100)} />
        </Stat>
        <Stat label="Next hire" tone="nogo">
          <Unit value={value("funds", 24_000)} />
        </Stat>
      </StatStrip>,
    );

    await expectNoA11yViolations(container);
  });
});

describe("StatContributions", () => {
  it("draws a contributed quantity through the kit's own Unit", () => {
    render(
      <WithStats
        entries={[
          {
            id: "rp1:in-training",
            label: "In training",
            value: value("count", 4),
            detail: "across 3 courses",
          },
        ]}
      >
        <StatStrip>
          <StatContributions slot={SLOT} />
        </StatStrip>
      </WithStats>,
    );

    expect(screen.getByText("In training")).toBeInTheDocument();
    // Unit's own rendering, not a number the contributor formatted.
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("across 3 courses")).toBeInTheDocument();
  });

  it("puts each cell in the host's own strip rather than a block of its own", () => {
    const { container } = render(
      <WithStats
        entries={[
          { id: "a", label: "Lapsing", text: "2" },
          { id: "b", label: "Courses", text: "3" },
        ]}
      >
        <StatStrip data-testid="strip">
          <Stat label="Funds">100</Stat>
          <StatContributions slot={SLOT} />
        </StatStrip>
      </WithStats>,
    );

    /*
     * Three siblings of the strip, not one vanilla cell beside a wrapper holding
     * the contributed pair: a contributed figure has to be indistinguishable
     * from a built-in one, and a wrapper is what would make the Uplink's stats
     * read as a block bolted onto the end of the row.
     */
    const strip = screen.getByTestId("strip");
    expect(strip.children).toHaveLength(3);
    expect(container.querySelectorAll("dl")).toHaveLength(3);
  });

  it("says a figure is absent rather than leaving the cell blank", () => {
    render(
      <WithStats entries={[{ id: "a", label: "Lapsing", value: null }]}>
        <StatContributions slot={SLOT} />
      </WithStats>,
    );

    // The null token, the same one every unread reading in the app draws.
    expect(screen.getByText("Lapsing")).toBeInTheDocument();
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("renders no DOM at all when nothing is contributed", () => {
    const { container } = render(
      <WithStats entries={[]}>
        <StatContributions slot={SLOT} />
      </WithStats>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
