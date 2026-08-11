import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterBar, type FilterBarGroup } from "./FilterBar";
import { axe } from "./test/axe";

const MULTI: FilterBarGroup = {
  id: "process",
  label: "Process",
  selection: "multi",
  options: [
    { id: "a:scrubber", label: "Scrubber", active: false },
    { id: "a:recycler", label: "Water Recycler", active: false },
  ],
};

const SINGLE: FilterBarGroup = {
  id: "resource",
  label: "Resource",
  selection: "single",
  options: [
    { id: "b:Ore", label: "Ore", active: false },
    { id: "b:LiquidFuel", label: "LiquidFuel", active: false },
  ],
};

describe("FilterBar", () => {
  it("renders a multi group as pressable chips", () => {
    render(<FilterBar groups={[MULTI]} onChange={() => {}} />);

    const chip = screen.getByRole("button", { name: "Scrubber" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("group", { name: "Process" })).toBeTruthy();
  });

  it("adds to a multi group's selection rather than replacing it, so the OR survives", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const withOneActive: FilterBarGroup = {
      ...MULTI,
      options: [{ ...MULTI.options[0], active: true }, { ...MULTI.options[1] }],
    };

    render(<FilterBar groups={[withOneActive]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Water Recycler" }));

    expect(onChange).toHaveBeenCalledWith("process", [
      "a:scrubber",
      "a:recycler",
    ]);
  });

  it("clears a chip that was already selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const withOneActive: FilterBarGroup = {
      ...MULTI,
      options: [{ ...MULTI.options[0], active: true }, { ...MULTI.options[1] }],
    };

    render(<FilterBar groups={[withOneActive]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Scrubber" }));

    expect(onChange).toHaveBeenCalledWith("process", []);
  });

  it("renders a single group as a labelled dropdown with show-all first", () => {
    render(
      <FilterBar
        groups={[SINGLE]}
        onChange={() => {}}
        allLabel="All resources"
      />,
    );

    const select = screen.getByLabelText("Resource") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "All resources",
      "Ore",
      "LiquidFuel",
    ]);
  });

  it("a single group replaces its selection, and show-all clears it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <FilterBar
        groups={[
          { ...SINGLE, options: [SINGLE.options[0], SINGLE.options[1]] },
        ]}
        onChange={onChange}
        allLabel="All resources"
      />,
    );

    await user.selectOptions(screen.getByLabelText("Resource"), "b:Ore");
    expect(onChange).toHaveBeenCalledWith("resource", ["b:Ore"]);

    await user.selectOptions(screen.getByLabelText("Resource"), "");
    expect(onChange).toHaveBeenLastCalledWith("resource", []);
  });

  it("keeps a multi group multi-select however many options it has", () => {
    // The regression this guards: picking the control by option count must
    // never silently downgrade a `multi` axis to single-select, or the same
    // filter behaves differently on a busy vessel than on a quiet one.
    const many: FilterBarGroup = {
      ...MULTI,
      options: Array.from({ length: 12 }, (_, i) => ({
        id: `a:p${i}`,
        label: `Process ${i}`,
        active: false,
      })),
    };

    render(<FilterBar groups={[many]} onChange={() => {}} />);

    expect(screen.getAllByRole("button")).toHaveLength(12);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("renders nothing when no group has options", () => {
    const { container } = render(
      <FilterBar
        groups={[{ id: "empty", selection: "multi", options: [] }]}
        onChange={() => {}}
      />,
    );

    expect(container.textContent).toBe("");
  });

  it("has no axe violations with both group kinds on screen", async () => {
    const { container } = render(
      <FilterBar groups={[SINGLE, MULTI]} onChange={() => {}} />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
