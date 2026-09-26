import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Switch } from "./Switch";
import { emittedStateRuleFor } from "./test/emittedRule";

function Controlled() {
  const [on, setOn] = useState(false);
  return <Switch checked={on} onChange={setOn} label="Auto-stage" />;
}

describe("Switch", () => {
  it("toggles from the keyboard with Space", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole("checkbox", { name: "Auto-stage" });
    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(" ");
    expect(box).toBeChecked();
  });

  it("draws the kit focus ring on the visible track when its hidden input has keyboard focus", () => {
    render(<Switch checked={false} onChange={() => {}} label="Auto-stage" />);
    const input = screen.getByRole("checkbox", { name: "Auto-stage" });
    expect(emittedStateRuleFor(input, ":focus-visible+")).toContain(
      "outline:2px solid var(--color-focus)",
    );
  });

  it("has no axe violations labelled visibly or by aria-label", async () => {
    const { container } = render(
      <>
        <Switch checked onChange={() => {}} label="Auto-stage" />
        <Switch checked={false} onChange={() => {}} aria-label="Show grid" />
        <Switch checked disabled onChange={() => {}} label="Locked" />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
