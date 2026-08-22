import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("exposes progressbar semantics with the current value", () => {
    render(<ProgressBar value={42} ariaLabel="Biome coverage" />);
    const bar = screen.getByRole("progressbar", { name: "Biome coverage" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps values above 100", () => {
    render(<ProgressBar value={150} ariaLabel="Coverage" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("clamps values below 0", () => {
    render(<ProgressBar value={-10} ariaLabel="Coverage" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("treats a non-finite value as 0", () => {
    render(<ProgressBar value={Number.NaN} ariaLabel="Coverage" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("defaults the fill to the accent colour", () => {
    render(<ProgressBar value={50} ariaLabel="Coverage" />);
    const fill = screen.getByRole("progressbar").firstElementChild;
    expect(fill).toHaveStyle({ background: "var(--color-accent-fg)" });
  });

  it("uses fillColor to override the default when given a status token", () => {
    render(
      <ProgressBar
        value={90}
        ariaLabel="Transit"
        fillColor="var(--color-status-nogo-bg)"
      />,
    );
    const fill = screen.getByRole("progressbar").firstElementChild;
    expect(fill).toHaveStyle({ background: "var(--color-status-nogo-bg)" });
  });
});
