import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
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

  /* jsdom computes no layout, so the assertion is on the declaration that
     decides it. A badge beside a caption that wraps to several lines was
     rendering as an ellipse the height of the whole caption, because a flex
     parent stretches its items by default and the pill radius follows the box. */
  it("sizes itself rather than stretching to a flex row", () => {
    render(<Badge severity="nominal">TRAINING</Badge>);
    expect(getComputedStyle(screen.getByText("TRAINING")).alignSelf).toBe(
      "center",
    );
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
});
