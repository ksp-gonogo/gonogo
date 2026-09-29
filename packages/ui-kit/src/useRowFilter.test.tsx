import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";
import { FilterRegion, useRowFilter } from "./useRowFilter";

const ROWS = ["Mun biome", "Minmus flats"];

function Region() {
  const filter = useRowFilter();
  return (
    <FilterRegion filter={filter}>
      <ul>
        {ROWS.filter(filter.matches).map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </FilterRegion>
  );
}

function PinnedFilter() {
  const filter = useRowFilter();
  return (
    <Panel
      panelTitle="LIST"
      panelFilter={filter}
      sections={
        <ul>
          {ROWS.filter(filter.matches).map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      }
    />
  );
}

function follows(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("FilterRegion", () => {
  it("draws the filter control above the list it narrows", () => {
    render(<Region />);
    expect(
      follows(screen.getByLabelText("Search"), screen.getByText("Mun biome")),
    ).toBe(true);
  });

  it("narrows the list it wraps", () => {
    render(<Region />);
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "minmus" },
    });
    expect(screen.queryByText("Mun biome")).toBeNull();
    expect(screen.getByText("Minmus flats")).toBeTruthy();
  });
});

describe("Panel panelFilter", () => {
  it("pins the filter in the header, outside the scrolling body", () => {
    render(<PinnedFilter />);
    const search = screen.getByLabelText("Search");
    expect(search.closest("[data-panel-header]")).not.toBeNull();
    expect(follows(search, screen.getByText("Mun biome"))).toBe(true);
  });
});
