import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { axe } from "./test/axe";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>kos</Badge>);
    expect(screen.getByText("kos")).toBeInTheDocument();
  });

  it("applies a different class for different tones", () => {
    const { rerender } = render(
      <Badge tone="neutral" data-testid="b">
        N
      </Badge>,
    );
    const neutralClass = screen.getByTestId("b").className;
    rerender(
      <Badge tone="warn" data-testid="b">
        N
      </Badge>,
    );
    expect(screen.getByTestId("b").className).not.toBe(neutralClass);
  });

  it("applies a different class for different sizes", () => {
    const { rerender } = render(
      <Badge size="md" data-testid="b">
        N
      </Badge>,
    );
    const mdClass = screen.getByTestId("b").className;
    rerender(
      <Badge size="sm" data-testid="b">
        N
      </Badge>,
    );
    expect(screen.getByTestId("b").className).not.toBe(mdClass);
  });

  it("forwards arbitrary attributes (e.g. aria-label, title)", () => {
    render(
      <Badge aria-label="Firing" title="alarm state">
        F
      </Badge>,
    );
    const node = screen.getByLabelText("Firing");
    expect(node).toHaveAttribute("title", "alarm state");
  });

  it("has no axe violations across all tones and sizes", async () => {
    const { container } = render(
      <>
        <Badge tone="neutral">neutral</Badge>
        <Badge tone="go">go</Badge>
        <Badge tone="nogo">nogo</Badge>
        <Badge tone="warn">warn</Badge>
        <Badge tone="info">info</Badge>
        <Badge size="sm">small</Badge>
      </>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
