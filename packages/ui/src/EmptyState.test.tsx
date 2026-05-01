import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";
import { axe } from "./test/axe";

describe("EmptyState", () => {
  it("renders children", () => {
    render(<EmptyState>No data yet</EmptyState>);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("applies different classes for inline vs fill layouts", () => {
    const { rerender } = render(
      <EmptyState data-testid="e">No data</EmptyState>,
    );
    const inlineClass = screen.getByTestId("e").className;
    rerender(
      <EmptyState data-testid="e" layout="fill">
        No data
      </EmptyState>,
    );
    expect(screen.getByTestId("e").className).not.toBe(inlineClass);
  });

  it("forwards arbitrary div attributes", () => {
    render(
      <EmptyState data-testid="e" role="status">
        Awaiting telemetry
      </EmptyState>,
    );
    expect(screen.getByTestId("e")).toHaveAttribute("role", "status");
  });

  it("has no axe violations in either layout", async () => {
    const { container } = render(
      <>
        <EmptyState>Inline empty state</EmptyState>
        <EmptyState layout="fill">Filled empty state</EmptyState>
      </>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
