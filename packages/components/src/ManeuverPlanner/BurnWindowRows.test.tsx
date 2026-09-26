import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { BurnWindowRows } from "./BurnWindowRows";

describe("BurnWindowRows: no restated heading, no per-row noise subtitle", () => {
  it("does not restate a 'Burn window' caption of its own, with a burn-time model present", () => {
    const { container } = render(
      <BurnWindowRows
        burn={{ ut: 1000, ignitionUt: 980, cutoffUt: 1025 }}
        nowUt={900}
      />,
    );

    expect(screen.queryByText("Burn window")).toBeNull();
    // The duration line is the one fact the header row adds.
    expect(container.textContent).toMatch(/lasts/i);

    expect(screen.getByText("Ignition")).toBeInTheDocument();
    expect(screen.getByText("Half-Δv")).toBeInTheDocument();
    expect(screen.getByText("Cutoff")).toBeInTheDocument();
    expect(screen.queryByText("rocket equation")).toBeNull();
    expect(screen.queryByText("planned")).toBeNull();
  });

  it("keeps the WHY for an impulsive plan (no burn-time model), which is not the noise that was dropped", () => {
    render(<BurnWindowRows burn={{ ut: 1000 }} nowUt={900} />);

    expect(screen.queryByText("Burn window")).toBeNull();
    expect(screen.getByText("Ignition")).toBeInTheDocument();
    expect(screen.queryByText("rocket equation")).toBeNull();
    expect(screen.queryByText("planned")).toBeNull();
    // "no burn-time model" answers a question the row's null-display value cannot.
    expect(screen.getAllByText(/no burn-time model/i).length).toBeGreaterThan(
      0,
    );
  });
});
