import type { FilterEntry } from "@ksp-gonogo/sitrep-sdk";
import { fireEvent, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { WidgetMetaContext } from "./contexts/WidgetMetaContext";
import { useContributedFilters } from "./contributedFilters";
import { clearContributions, registerContribution } from "./contributions";
import { ContributionsProvider } from "./contributionsRuntime";

// A fixture list widget, standing in for any host with a filterable list. Note
// what it does NOT contain: any knowledge of what a filter means. It renders
// whatever facets arrived and applies them, which is the whole mechanism.
interface Row {
  id: string;
  colour: string;
  shape: string;
}

declare module "./contributions" {
  interface ContributionRegistry {
    "fixture-list.filters": {
      entry: FilterEntry<Row>;
      topics: never;
    };
  }
}

const ROWS: Row[] = [
  { id: "a", colour: "red", shape: "square" },
  { id: "b", colour: "blue", shape: "square" },
  { id: "c", colour: "red", shape: "circle" },
];

beforeEach(() => {
  clearContributions();
});

function ListWidget() {
  const filters = useContributedFilters("fixture-list.filters");
  const rows = filters.apply(ROWS);

  return (
    <div>
      {filters.groups.map((group) => (
        <div key={group.id}>
          <span>{`group:${group.id}:${group.selection}`}</span>
          {group.options.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.active}
              onClick={() => {
                const next = group.options
                  .filter((o) => (o.id === option.id ? !o.active : o.active))
                  .map((o) => o.id);
                filters.onChange(group.id, next);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ))}
      <span>{`active:${filters.activeCount}`}</span>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>{`row:${row.id}`}</li>
        ))}
      </ul>
    </div>
  );
}

function renderWidget() {
  return render(
    <WidgetMetaContext.Provider
      value={{
        componentId: "fixture-list",
        contributionSlots: ["fixture-list.filters"],
      }}
    >
      <ContributionsProvider>
        <ListWidget />
      </ContributionsProvider>
    </WidgetMetaContext.Provider>,
  );
}

function registerColourFilters(colours: readonly string[]): void {
  registerContribution({
    id: "colours",
    contributes: "fixture-list.filters",
    compute: () =>
      colours.map((colour) => ({
        id: colour,
        label: colour,
        group: "colour",
        groupLabel: "Colour",
        selection: "multi" as const,
        predicate: (row: Row) => row.colour === colour,
      })),
  });
}

async function visibleRows(): Promise<string[]> {
  const items = await screen.findAllByRole("listitem");
  return items.map((item) => item.textContent ?? "");
}

describe("useContributedFilters", () => {
  it("shows everything until an operator selects a facet", async () => {
    registerColourFilters(["red", "blue"]);
    renderWidget();

    await waitFor(() =>
      expect(screen.getByText("group:colour:multi")).toBeTruthy(),
    );
    expect(await visibleRows()).toEqual(["row:a", "row:b", "row:c"]);
    expect(screen.getByText("active:0")).toBeTruthy();
  });

  it("narrows to a selected facet, and back to show-all when it is cleared", async () => {
    registerColourFilters(["red", "blue"]);
    renderWidget();

    fireEvent.click(await screen.findByRole("button", { name: "blue" }));
    await waitFor(async () => expect(await visibleRows()).toEqual(["row:b"]));
    expect(screen.getByText("active:1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "blue" }));
    expect(await visibleRows()).toEqual(["row:a", "row:b", "row:c"]);
  });

  it("ORs facets within a group", async () => {
    registerColourFilters(["red", "blue"]);
    renderWidget();

    fireEvent.click(await screen.findByRole("button", { name: "red" }));
    fireEvent.click(screen.getByRole("button", { name: "blue" }));

    // Both facets of one axis: the union, not the (empty) intersection.
    await waitFor(async () =>
      expect(await visibleRows()).toEqual(["row:a", "row:b", "row:c"]),
    );
    expect(screen.getByText("active:2")).toBeTruthy();
  });

  it("ANDs across groups, so a second axis narrows what the first left", async () => {
    registerColourFilters(["red", "blue"]);
    registerContribution({
      id: "shapes",
      contributes: "fixture-list.filters",
      compute: () => [
        {
          id: "circle",
          label: "circle",
          group: "shape",
          groupLabel: "Shape",
          predicate: (row: Row) => row.shape === "circle",
        },
      ],
    });
    renderWidget();

    fireEvent.click(await screen.findByRole("button", { name: "red" }));
    fireEvent.click(screen.getByRole("button", { name: "circle" }));

    // red ∩ circle is row c alone; row a is red but square.
    await waitFor(async () => expect(await visibleRows()).toEqual(["row:c"]));
  });

  it("composes two contributions feeding the SAME group as one axis", async () => {
    registerColourFilters(["red"]);
    registerContribution({
      id: "more-colours",
      contributes: "fixture-list.filters",
      compute: () => [
        {
          id: "blue",
          label: "blue",
          group: "colour",
          groupLabel: "Colour",
          predicate: (row: Row) => row.colour === "blue",
        },
      ],
    });
    renderWidget();

    await waitFor(() =>
      expect(screen.getAllByText("group:colour:multi")).toHaveLength(1),
    );
    expect(screen.getByRole("button", { name: "red" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "blue" })).toBeTruthy();
  });

  it("keeps two contributions' identical local ids apart", async () => {
    registerContribution({
      id: "first",
      contributes: "fixture-list.filters",
      compute: () => [
        {
          id: "same",
          label: "from first",
          group: "shared",
          predicate: (row: Row) => row.id === "a",
        },
      ],
    });
    registerContribution({
      id: "second",
      contributes: "fixture-list.filters",
      compute: () => [
        {
          id: "same",
          label: "from second",
          group: "shared",
          predicate: (row: Row) => row.id === "b",
        },
      ],
    });
    renderWidget();

    fireEvent.click(await screen.findByRole("button", { name: "from first" }));

    // Selecting one must not light up (or apply) the other's identically-named facet.
    await waitFor(async () => expect(await visibleRows()).toEqual(["row:a"]));
    expect(
      screen
        .getByRole("button", { name: "from second" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("a standalone filter is its own group of one", async () => {
    registerContribution({
      id: "standalone",
      contributes: "fixture-list.filters",
      compute: () => [
        {
          id: "only-a",
          label: "only a",
          predicate: (row: Row) => row.id === "a",
        },
      ],
    });
    renderWidget();

    await waitFor(() =>
      expect(screen.getByText("group:standalone:only-a:multi")).toBeTruthy(),
    );
  });

  it("takes the group's selection semantics from its first contributor, never from option count", async () => {
    registerContribution({
      id: "single-axis",
      contributes: "fixture-list.filters",
      compute: () =>
        ["red", "blue"].map((colour) => ({
          id: colour,
          label: colour,
          group: "colour",
          selection: "single" as const,
          predicate: (row: Row) => row.colour === colour,
        })),
    });
    renderWidget();

    await waitFor(() =>
      expect(screen.getByText("group:colour:single")).toBeTruthy(),
    );
  });

  it("falls back to show-all when the data behind a selected facet goes away", async () => {
    // The facet set follows a mutable source, standing in for a contribution
    // whose Topic stopped reporting a resource this vessel no longer carries.
    let colours = ["red", "blue"];
    registerContribution({
      id: "volatile",
      contributes: "fixture-list.filters",
      compute: () =>
        colours.map((colour) => ({
          id: colour,
          label: colour,
          group: "colour",
          predicate: (row: Row) => row.colour === colour,
        })),
    });
    const { rerender } = renderWidget();

    fireEvent.click(await screen.findByRole("button", { name: "blue" }));
    await waitFor(async () => expect(await visibleRows()).toEqual(["row:b"]));

    colours = ["red"];
    clearContributions();
    registerContribution({
      id: "volatile",
      contributes: "fixture-list.filters",
      compute: () =>
        colours.map((colour) => ({
          id: colour,
          label: colour,
          group: "colour",
          predicate: (row: Row) => row.colour === colour,
        })),
    });
    rerender(
      <WidgetMetaContext.Provider
        value={{
          componentId: "fixture-list",
          contributionSlots: ["fixture-list.filters"],
        }}
      >
        <ContributionsProvider>
          <ListWidget />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>,
    );

    // A selection naming a facet that is gone hides nothing, rather than
    // hiding everything with no way back.
    await waitFor(async () =>
      expect(await visibleRows()).toEqual(["row:a", "row:b", "row:c"]),
    );
    expect(screen.getByText("active:0")).toBeTruthy();
  });

  it("contributes nothing and hides nothing when no filters are registered", async () => {
    renderWidget();

    expect(await visibleRows()).toEqual(["row:a", "row:b", "row:c"]);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
