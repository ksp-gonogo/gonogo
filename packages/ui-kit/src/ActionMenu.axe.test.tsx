import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu } from "./ActionMenu";

describe("ActionMenu a11y", () => {
  it("has no axe violations with grouped, partly-disabled items", async () => {
    const { container } = render(
      <ActionMenu
        items={[
          { key: "a", label: "Extend Solar Panel", group: "Solar Panel" },
          { key: "b", label: "Retract", group: "Solar Panel", disabled: true },
          { key: "c", label: "Toggle Light", group: "Light" },
        ]}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
        ariaLabel="Mk1 Command Pod actions"
      />,
    );

    await expectNoA11yViolations(container);
  });

  it("has no axe violations while empty", async () => {
    const { container } = render(
      <ActionMenu
        items={[]}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
        ariaLabel="Mk1 Command Pod actions"
        emptyLabel="Awaiting actions…"
      />,
    );

    await expectNoA11yViolations(container);
  });
});
