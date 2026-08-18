import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu } from "./ActionMenu";
import { axe } from "./test/axe";

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

    expect(await axe(container)).toHaveNoViolations();
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

    expect(await axe(container)).toHaveNoViolations();
  });
});
