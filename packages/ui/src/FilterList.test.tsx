import {
  ContributionsProvider,
  registerContribution,
  WidgetMetaContext,
  type WidgetMetaContextValue,
} from "@ksp-gonogo/core";
import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { FilterList, type FilterRow } from "./FilterList";

// Registered at module load as an Uplink would; no `requires`, so no TelemetryProvider is needed.
registerContribution({
  id: "filterlist-test-terms",
  contributes: "test-widget.filters",
  compute: () => ["Scrubber", "Water Recycler"],
});

const META: WidgetMetaContextValue = {
  componentId: "test-widget",
  contributionSlots: [],
};

// Row text differs from the chip labels so a query can tell a row from its toggle.
const ROWS: FilterRow[] = [
  {
    id: "co2",
    searchText: "CO2 Scrubber converter CarbonDioxide",
    node: <div>Scrubber unit</div>,
  },
  {
    id: "wr",
    searchText: "Water Recycler converter WasteWater Water",
    node: <div>Recycler unit</div>,
  },
  {
    id: "drill",
    searchText: "Drill-O-Matic drill Ore",
    node: <div>Ore drill unit</div>,
  },
];

function mountInWidget(rows: readonly FilterRow[] = ROWS) {
  return render(
    <WidgetMetaContext.Provider value={META}>
      <ContributionsProvider>
        <FilterList rows={rows} />
      </ContributionsProvider>
    </WidgetMetaContext.Provider>,
  );
}

describe("FilterList", () => {
  it("shows a toggle per contributed term, and every row at rest", async () => {
    mountInWidget();

    expect(
      await screen.findByRole("button", { name: "Scrubber" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Water Recycler" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Scrubber unit")).toBeInTheDocument();
    expect(screen.getByText("Recycler unit")).toBeInTheDocument();
    expect(screen.getByText("Ore drill unit")).toBeInTheDocument();
  });

  it("narrows to rows whose text matches a toggled term", async () => {
    mountInWidget();
    fireEvent.click(await screen.findByRole("button", { name: "Scrubber" }));

    expect(screen.getByText("Scrubber unit")).toBeInTheDocument();
    expect(screen.queryByText("Recycler unit")).not.toBeInTheDocument();
    expect(screen.queryByText("Ore drill unit")).not.toBeInTheDocument();
  });

  it("stacks toggles as AND", async () => {
    mountInWidget();
    fireEvent.click(await screen.findByRole("button", { name: "Scrubber" }));
    fireEvent.click(screen.getByRole("button", { name: "Water Recycler" }));

    // No single row's text contains both "scrubber" and "water recycler".
    expect(screen.queryByText("Scrubber unit")).not.toBeInTheDocument();
    expect(screen.queryByText("Recycler unit")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing matches the filter")).toBeInTheDocument();
  });

  it("applies the typed box, ANDed with the toggles", async () => {
    mountInWidget();
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "drill" },
    });

    expect(screen.getByText("Ore drill unit")).toBeInTheDocument();
    expect(screen.queryByText("Scrubber unit")).not.toBeInTheDocument();
    expect(screen.queryByText("Recycler unit")).not.toBeInTheDocument();
  });

  it("passes rows through with no chips outside a widget context", () => {
    // No WidgetMetaContext / ContributionsProvider: nothing to complete the segment against, so the term list is stably empty and every row passes.
    render(<FilterList rows={ROWS} />);

    expect(
      screen.queryByRole("button", { name: "Scrubber" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Scrubber unit")).toBeInTheDocument();
    expect(screen.getByText("Recycler unit")).toBeInTheDocument();
    expect(screen.getByText("Ore drill unit")).toBeInTheDocument();
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
  });

  it("draws the filter above the rows it narrows", async () => {
    mountInWidget();
    const search = screen.getByLabelText("Search");
    const firstRow = screen.getByText("Scrubber unit");
    expect(
      search.compareDocumentPosition(firstRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    const { container } = mountInWidget();
    await screen.findByRole("button", { name: "Scrubber" });
    await expectNoA11yViolations(container);
  });
});
