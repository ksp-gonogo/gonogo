import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { HeldBadge } from "./HeldBadge";
import { formatStreamStatus } from "./status/streamStatusWord";

describe("HeldBadge", () => {
  it("prints the grade in the word its stream status badge uses", () => {
    render(<HeldBadge grade="last-before-blackout" />);
    expect(
      screen.getByText(formatStreamStatus("last-before-blackout") ?? ""),
    ).toBeInTheDocument();
  });

  it("names what is held in its hover text, in the same word", () => {
    render(<HeldBadge grade="held" subject="Contract board" />);
    expect(screen.getByText("HELD")).toHaveAttribute(
      "data-tooltip",
      "Contract board: HELD",
    );
  });

  it("is not a live region, so many rows going held are not many announcements", () => {
    render(<HeldBadge grade="held" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<HeldBadge grade="recorded" subject="Lab" />);
    await expectNoA11yViolations(container);
  });
});
