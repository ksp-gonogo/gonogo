import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { SeriesRow } from "./SeriesRow";

describe("SeriesRow", () => {
  it("names each choice, so a screen reader and a touch operator are told what a bare dropdown sets", () => {
    render(
      <SeriesRow
        series={{ id: "a", key: "", type: "line", axis: "auto" }}
        numericKeys={[]}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Series style")).toHaveValue("line");
    expect(screen.getByLabelText("Series axis")).toHaveValue("auto");
  });

  it("lets its controls wrap, so none is squeezed to a sliver in a narrow panel", () => {
    const { container } = render(
      <SeriesRow
        series={{ id: "a", key: "", type: "line", axis: "auto" }}
        numericKeys={[]}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const row = screen.getByLabelText("Series style").parentElement;
    expect(row).toHaveStyle({ flexWrap: "wrap" });
    expect(container.querySelectorAll("select")).toHaveLength(2);
  });
});
