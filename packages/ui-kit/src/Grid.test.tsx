import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Grid } from "./Grid";

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
});
