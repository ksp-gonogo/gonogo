import { value } from "@ksp-gonogo/sitrep-sdk";
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

describe("ProgressBar driven by an amount and a capacity", () => {
  it("derives the fill from the pair rather than a division at the call site", () => {
    render(
      <ProgressBar
        quantity={{ amount: value("count", 3), capacity: value("count", 4) }}
        ariaLabel="Crew assigned"
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Crew assigned" });
    expect(bar).toHaveAttribute("aria-valuenow", "75");
  });

  it("converts across rungs before dividing, so the pair need not share one", () => {
    render(
      <ProgressBar
        quantity={{ amount: value("kg", 500), capacity: value("t", 1) }}
        ariaLabel="Propellant"
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
  });

  it("speaks both halves, at one rung, so the fill is not the only reading", () => {
    render(
      <ProgressBar
        quantity={{ amount: value("bp", 120), capacity: value("bp", 400) }}
        ariaLabel="Pad operation progress"
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuetext")).toMatch(/120.*of.*400/);
  });

  it("draws the absent form for a pair that could not be read", () => {
    render(<ProgressBar quantity={null} ariaLabel="Crew assigned" />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("draws the absent form for a capacity of zero, which is no tank at all", () => {
    render(
      <ProgressBar
        quantity={{ amount: value("count", 0), capacity: value("count", 0) }}
        ariaLabel="Crew assigned"
      />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("clamps a pair that overruns its capacity", () => {
    render(
      <ProgressBar
        quantity={{ amount: value("bp", 500), capacity: value("bp", 400) }}
        ariaLabel="Pad operation progress"
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });
});
