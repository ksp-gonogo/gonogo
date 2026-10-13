import { render, screen } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { WithheldPath } from "./WithheldPath";

const SHAPE_NOT_STATED = {
  shape: "withheld",
  reason: "shape-not-stated",
} as const;

describe("WithheldPath", () => {
  it("draws the heading on the tile and keeps the sentence out of it", () => {
    const { container } = render(<WithheldPath withheld={SHAPE_NOT_STATED} />);
    expect(visibleText(container)).toContain("SHAPE NOT STATED");
    expect(visibleText(container)).not.toContain("Nothing has said");
  });

  it("gives the sentence as the heading's tooltip and description", () => {
    render(<WithheldPath withheld={SHAPE_NOT_STATED} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute(
      "data-tooltip",
      "Nothing has said whether this trajectory is a conic.",
    );
    expect(status).toHaveAttribute(
      "aria-description",
      "Nothing has said whether this trajectory is a conic.",
    );
  });

  it("can be focused from the keyboard, so the sentence is reachable without a pointer", () => {
    render(<WithheldPath withheld={SHAPE_NOT_STATED} layout="fill" />);
    expect(screen.getByRole("status")).toHaveAttribute("tabindex", "0");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <WithheldPath withheld={SHAPE_NOT_STATED} layout="fill" />,
    );
    await expectNoA11yViolations(container);
  });
});
