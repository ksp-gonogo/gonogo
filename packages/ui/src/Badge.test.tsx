import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>kos</Badge>);
    expect(screen.getByText("kos")).toBeInTheDocument();
  });

  it("applies a different class for different severities", () => {
    const { rerender } = render(<Badge>N</Badge>);
    const decorativeClass = screen.getByText("N").className;
    rerender(<Badge severity="warning">N</Badge>);
    expect(screen.getByText("N").className).not.toBe(decorativeClass);
  });

  it("applies a different class for different sizes", () => {
    const { rerender } = render(<Badge size="md">N</Badge>);
    const mdClass = screen.getByText("N").className;
    rerender(<Badge size="sm">N</Badge>);
    expect(screen.getByText("N").className).not.toBe(mdClass);
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

  it("has no axe violations across all severities and sizes", async () => {
    const { container } = render(
      <>
        <Badge>decorative</Badge>
        <Badge severity="nominal">nominal</Badge>
        <Badge severity="info">info</Badge>
        <Badge severity="caution">caution</Badge>
        <Badge severity="warning">warning</Badge>
        <Badge severity="critical">critical</Badge>
        <Badge severity="offline">offline</Badge>
        <Badge size="sm">small</Badge>
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
