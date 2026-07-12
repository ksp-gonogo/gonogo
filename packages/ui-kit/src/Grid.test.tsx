import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { ThemeProvider } from "styled-components";
import { describe, expect, it } from "vitest";
import { defaultDarkTheme } from "./defaultDarkTheme";
import { Grid } from "./Grid";

function renderWithTheme(node: ReactElement) {
  return render(<ThemeProvider theme={defaultDarkTheme}>{node}</ThemeProvider>);
}

describe("Grid", () => {
  it("renders its children", () => {
    renderWithTheme(
      <Grid cols="120px 1fr 60px">
        <span>Altimetry</span>
      </Grid>,
    );
    expect(screen.getByText("Altimetry")).toBeInTheDocument();
  });

  it("applies a fixed column template when cols is set", () => {
    renderWithTheme(
      <Grid cols="120px 1fr 60px" data-testid="grid">
        <span>a</span>
      </Grid>,
    );
    expect(screen.getByTestId("grid")).toHaveStyle({
      gridTemplateColumns: "120px 1fr 60px",
    });
  });

  it("applies an auto-fill template when minColWidth is set", () => {
    renderWithTheme(
      <Grid minColWidth="200px" data-testid="grid">
        <span>a</span>
      </Grid>,
    );
    expect(screen.getByTestId("grid")).toHaveStyle({
      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    });
  });
});
