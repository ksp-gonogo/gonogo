import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Grid } from "./Grid";
import {
  squareAreaRules,
  squareColumnChoices,
  squareHeadingAllowance,
} from "./gridSquares";

describe("Grid", () => {
  it("renders its children", () => {
    render(
      <Grid cols="120px 1fr 60px">
        <span>Altimetry</span>
      </Grid>,
    );
    expect(screen.getByText("Altimetry")).toBeInTheDocument();
  });

  it("applies a fixed column template when cols is set", () => {
    render(
      <Grid cols="120px 1fr 60px" data-testid="grid">
        <span>a</span>
      </Grid>,
    );
    expect(screen.getByTestId("grid")).toHaveStyle({
      gridTemplateColumns: "120px 1fr 60px",
    });
  });

  it("applies an auto-fill template, capped at the container, when minColWidth is set", () => {
    render(
      <Grid minColWidth="200px" data-testid="grid">
        <span>a</span>
      </Grid>,
    );
    expect(screen.getByTestId("grid")).toHaveStyle({
      gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))",
    });
  });

  it("auto-fits where fit is set, so a lone cell takes the row", () => {
    render(
      <Grid minColWidth="7rem" fit data-testid="grid">
        <span>a</span>
      </Grid>,
    );
    expect(screen.getByTestId("grid")).toHaveStyle({
      gridTemplateColumns: "repeat(auto-fit, minmax(min(7rem, 100%), 1fr))",
    });
  });

  it("stretches its cells to a row's height on align=stretch", () => {
    render(
      <Grid align="stretch" data-testid="grid">
        <span>a</span>
      </Grid>,
    );
    expect(screen.getByTestId("grid")).toHaveStyle({ alignItems: "stretch" });
  });

  describe("squares", () => {
    /** Every styled-components rule the render injected, as one string. */
    const injectedCss = () =>
      Array.from(document.querySelectorAll("style"))
        .map((el) => el.textContent)
        .join("\n");

    it("offers only the column counts that save a row", () => {
      expect(squareColumnChoices(3).map((c) => c.cols)).toEqual([1, 2, 3]);
      expect(squareColumnChoices(4).map((c) => c.cols)).toEqual([1, 2, 4]);
    });

    it("makes every cell a size container its child can draw a square in", () => {
      const { container } = render(
        <Grid squares minColWidth="200px">
          <span>a</span>
          <span>b</span>
        </Grid>,
      );
      const grid = container.querySelector("[data-grid-squares]");
      expect(grid?.children).toHaveLength(2);
      expect(injectedCss()).toMatch(/>\*\{container-type:size;/);
    });

    it("picks its columns from the shape of the space it is given", () => {
      render(
        <Grid squares minColWidth="200px" squareHeadingPx={17}>
          <span>a</span>
          <span>b</span>
          <span>c</span>
        </Grid>,
      );
      expect(injectedCss()).toContain(
        "@container grid-squares (aspect-ratio >= 1.32) and ((width >= calc(3 * 200px + 16px)) or (height < calc(2 * (200px + 25px) + 8px)))",
      );
    });

    it("sets four cells in one row when the area is too short for two rows of minimum squares, however narrow the columns", () => {
      render(
        <Grid squares minColWidth="200px" squareHeadingPx={17}>
          <span>a</span>
          <span>b</span>
          <span>c</span>
          <span>d</span>
        </Grid>,
      );
      expect(injectedCss()).toContain(
        "@container grid-squares (aspect-ratio >= 1.76) and ((width >= calc(4 * 200px + 24px)) or (height < calc(2 * (200px + 25px) + 8px)))",
      );
    });

    it("lets a container replace the height it asks for, and never asks for a square taller than its size container", () => {
      render(
        <Grid squares minColWidth="200px">
          <span>a</span>
        </Grid>,
      );
      expect(injectedCss()).toContain("min-height:var(--grid-squares-height,");
      expect(injectedCss()).toMatch(/min\(var\(--cell\),\s*200px,\s*100cqh/);
    });
    it("asks only for rows at minRowHeight when its cells fill the grid, and scrolls them in the room it is given", () => {
      render(
        <Grid squares minColWidth="88px" minRowHeight="48px" data-testid="grid">
          <span>a</span>
          <span>b</span>
          <span>c</span>
        </Grid>,
      );
      expect(injectedCss()).toContain(
        "min-height:var(--grid-squares-height, calc(var(--rows) * (48px + 0px)",
      );
      expect(squareAreaRules(3, "88px", 0, "8px", "48px")).not.toContain(
        "100cqh",
      );
      expect(injectedCss()).toContain(
        "(height < calc(1 * (48px + 8px) + 0px))",
      );
      const root = screen.getByTestId("grid");
      expect(root).toHaveStyle({ minHeight: "48px" });
      expect(
        root.querySelector("[data-scroll-area-inner] [data-grid-squares]"),
      ).not.toBeNull();
    });

    it("has no scroller of its own without minRowHeight", () => {
      render(
        <Grid squares data-testid="grid">
          <span>a</span>
        </Grid>,
      );
      const root = screen.getByTestId("grid");
      expect(root.querySelector("[data-scroll-area-inner]")).toBeNull();
      expect(root.querySelector("[data-grid-squares]")).not.toBeNull();
    });

    it("gives a cell's content the room its heading takes", () => {
      render(
        <Grid squares squareHeadingPx={17}>
          <span>a</span>
        </Grid>,
      );
      expect(injectedCss()).toContain(
        "--grid-square-heading:calc(17px + var(--gap-related));",
      );
    });

    it("gives the heading band to the square in a cell too small for squareHeadingMinPx, and hides what is marked as the heading", () => {
      render(
        <Grid squares squareHeadingPx={17} squareHeadingMinPx={128}>
          <span>a</span>
        </Grid>,
      );
      const css = injectedCss();
      expect(css).toContain("@container (width < 128px) or (height < 153px)");
      expect(css).toMatch(
        /@container \(width < 128px\) or \(height < 153px\)\{[^@]*--grid-square-heading:0px;[^@]*\[data-grid-square-heading\]\{display:none;\}/,
      );
    });

    it("allows no heading band on a cell that has none", () => {
      expect(squareHeadingAllowance(0)).toBe("0px");
      expect(squareHeadingAllowance(17)).toBe("(17px + var(--gap-related))");
    });
  });
});
