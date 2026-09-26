import { railTagsForCommand } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { emittedRuleFor } from "../test/emittedRule";
import { CommandOutcomeList } from "./CommandOutcomeList";

const DISCRETE = railTagsForCommand("vessel.control.setSasMode");

const REFUSED = {
  id: "r1",
  subject: "Stage",
  sentence: "Stage refused: no control",
  dismissLabel: "Clear stage refusal",
  tags: DISCRETE,
};

describe("CommandOutcomeList", () => {
  it("draws a warning outcome's command identity in the colour made for text on a dark ground", () => {
    render(<CommandOutcomeList ariaLabel="Refused" items={[REFUSED]} />);
    const [glyph] = screen.getAllByText("STAG");
    expect(emittedRuleFor(glyph)).toContain(
      "var(--color-status-warning-fg-muted)",
    );
  });

  it("has no axe violations with and without a clear control", async () => {
    const { container } = render(
      <>
        <CommandOutcomeList ariaLabel="Refused" items={[REFUSED]} />
        <CommandOutcomeList
          ariaLabel="Found"
          tone="notice"
          items={[{ ...REFUSED, id: "f1", sentence: "Stage found" }]}
          onDismiss={() => {}}
        />
      </>,
    );
    await expectNoA11yViolations(container);
  });

  it("draws nothing for an empty set when it is not live", () => {
    const { container } = render(
      <CommandOutcomeList ariaLabel="Refused" items={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("mounts a live list's region empty, so its first outcome arrives as a change to it", () => {
    const { rerender } = render(
      <CommandOutcomeList ariaLabel="Refused" items={[]} live />,
    );
    const region = screen.getByRole("status", { name: "Refused" });
    expect(region).toBeEmptyDOMElement();

    rerender(<CommandOutcomeList ariaLabel="Refused" items={[REFUSED]} live />);

    expect(screen.getByRole("status", { name: "Refused" })).toBe(region);
    expect(region).toHaveTextContent("Stage refused: no control");
  });

  it("announces each new outcome on its own rather than re-reading the list", () => {
    render(<CommandOutcomeList ariaLabel="Refused" items={[REFUSED]} live />);
    expect(screen.getByRole("status", { name: "Refused" })).toHaveAttribute(
      "aria-atomic",
      "false",
    );
  });

  it("has no axe violations as an empty live region", async () => {
    const { container } = render(
      <CommandOutcomeList ariaLabel="Refused" items={[]} live />,
    );
    await expectNoA11yViolations(container);
  });
});
