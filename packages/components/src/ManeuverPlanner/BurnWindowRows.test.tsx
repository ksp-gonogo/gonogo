import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { BurnWindowRows } from "./BurnWindowRows";

/**
 * The "BURN WINDOWS" section heading (rendered by `ManeuverPlanner/index.tsx`,
 * one level up) used to be immediately restated by this component's own
 * "Burn window" caption on the first row, and every instant row carried a
 * "rocket equation"/"planned" subtitle underneath its label that added no
 * information a reader didn't already have from the label and the value
 * beside it. Both were agreed to be dropped as noise; this pins that they
 * stay gone.
 */
describe("BurnWindowRows: no restated heading, no per-row noise subtitle", () => {
  it("does not restate a 'Burn window' caption of its own, with a burn-time model present", () => {
    const { container } = render(
      <BurnWindowRows
        burn={{ ut: 1000, ignitionUt: 980, cutoffUt: 1025 }}
        nowUt={900}
      />,
    );

    // The section heading is a sibling this component never renders, so the
    // absence of "Burn window" here is unambiguous.
    expect(screen.queryByText("Burn window")).toBeNull();
    // The duration line survives: it's the one fact the header row adds.
    expect(container.textContent).toMatch(/lasts/i);

    // Every row still says what happens and when, with no "rocket equation" /
    // "planned" subtitle underneath the label.
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
    // "no burn-time model" answers a question the row's own null-display
    // value can't. It stays, distinct from the routine-provenance text that
    // was dropped.
    expect(screen.getAllByText(/no burn-time model/i).length).toBeGreaterThan(
      0,
    );
  });
});
