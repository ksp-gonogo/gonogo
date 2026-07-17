import { describe, expect, it } from "vitest";
import { Grid } from "./Grid";
import { render, screen } from "./test/render";

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

  it("applies an auto-fill template when minColWidth is set", () => {
    render(
      <Grid minColWidth="200px" data-testid="grid">
        <span>a</span>
      </Grid>,
    );
    expect(screen.getByTestId("grid")).toHaveStyle({
      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    });
  });
});
