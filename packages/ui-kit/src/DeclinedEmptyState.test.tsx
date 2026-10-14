import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { DeclinedEmptyState, declinedState } from "./DeclinedEmptyState";

const DECLINED = {
  reason: "model-inapplicable",
  note: "The integrated trajectory could not be sampled.",
} as const;

describe("DeclinedEmptyState", () => {
  it("draws the state word on the tile and keeps the sentence out of it", () => {
    const { container } = render(<DeclinedEmptyState declined={DECLINED} />);
    expect(visibleText(container)).toContain("CANNOT MODEL");
    expect(visibleText(container)).not.toContain("could not be sampled");
  });

  it("gives the sentence as the state word's tooltip and description", () => {
    render(<DeclinedEmptyState declined={DECLINED} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-tooltip", DECLINED.note);
    expect(status).toHaveAttribute("aria-description", DECLINED.note);
  });

  it("reads NO DATA for a reason that has no state word", () => {
    const { container } = render(
      <DeclinedEmptyState declined={{ reason: "input-absent" }} />,
    );
    expect(visibleText(container)).toContain("NO DATA");
  });

  it("can be focused from the keyboard, so the sentence is reachable without a pointer", () => {
    render(<DeclinedEmptyState declined={DECLINED} layout="fill" />);
    expect(screen.getByRole("status")).toHaveAttribute("tabindex", "0");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <DeclinedEmptyState declined={DECLINED} layout="fill" />,
    );
    await expectNoA11yViolations(container);
  });
});

describe("declinedState", () => {
  it("gives a frame that cannot be built its own word, apart from a model that cannot run", () => {
    expect(declinedState({ reason: "frame-unavailable" })).toBe(
      "FRAME UNAVAILABLE",
    );
    expect(declinedState({ reason: "beyond-horizon" })).toBe("CANNOT MODEL");
  });

  it("tells a figure that comes back by itself from one that never will", () => {
    expect(
      declinedState({ reason: "beyond-horizon", resolvesByWaiting: true }),
    ).toBe("NOT YET COMPUTED");
    expect(declinedState({ reason: "beyond-horizon" })).toBe("CANNOT MODEL");
  });

  it("has no word for an absent input", () => {
    expect(declinedState({ reason: "input-absent" })).toBeNull();
  });
});
