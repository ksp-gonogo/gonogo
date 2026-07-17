import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";
import { axe } from "./test/axe";

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
