import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";
import { expectNoA11yViolations } from "./expectNoA11yViolations";
import { Panel } from "./Panel";
import { emittedRuleFor } from "./test/emittedRule";

describe("EmptyState", () => {
  it("renders children", () => {
    render(<EmptyState>No data yet</EmptyState>);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("applies different classes for inline vs fill layouts", () => {
    const { rerender } = render(<EmptyState>No data</EmptyState>);
    const inlineClass = screen.getByText("No data").className;
    rerender(<EmptyState layout="fill">No data</EmptyState>);
    expect(screen.getByText("No data").className).not.toBe(inlineClass);
  });

  it("forwards arbitrary div attributes", () => {
    render(<EmptyState role="status">Awaiting telemetry</EmptyState>);
    expect(screen.getByRole("status")).toHaveTextContent("Awaiting telemetry");
  });

  it("adds no inset of its own inline, so a panel body's padding is the only one", () => {
    render(
      <Panel panelTitle="Contracts">
        <EmptyState>No active contracts</EmptyState>
      </Panel>,
    );
    const rule = emittedRuleFor(screen.getByText("No active contracts"));
    expect(rule).not.toMatch(/padding/);
  });

  it("has no axe violations in either layout", async () => {
    const { container } = render(
      <>
        <EmptyState>Inline empty state</EmptyState>
        <EmptyState layout="fill">Filled empty state</EmptyState>
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
