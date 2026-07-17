import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";
import { render, screen } from "./test/render";

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
});
