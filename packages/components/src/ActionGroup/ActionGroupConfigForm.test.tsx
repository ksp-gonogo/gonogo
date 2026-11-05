import { getComponents } from "@ksp-gonogo/core";
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ActionGroupConfigForm } from "./ActionGroupConfigForm";
import type { ActionGroupConfig } from "./config";
import "./index";

const registeredDefault = () =>
  getComponents().find((def) => def.id === "action-group")
    ?.defaultConfig as ActionGroupConfig;

const select = () => screen.getByLabelText("Action Group") as HTMLSelectElement;
const selectedName = () => select().selectedOptions[0]?.textContent;

describe("ActionGroupConfigForm before any craft has reported its groups", () => {
  it("shows the group the widget's default acts on, and names it in the label", () => {
    const config = registeredDefault();
    render(<ActionGroupConfigForm config={config} onSave={vi.fn()} />);

    expect(select().value).toBe(config.actionGroupId);
    expect(selectedName()).toBe("AG1");
    expect(screen.getByLabelText("Custom Label")).toHaveAttribute(
      "placeholder",
      "AG1",
    );
  });

  it("shows the default group for a widget saved with no group at all", () => {
    render(
      <ActionGroupConfigForm
        config={{} as ActionGroupConfig}
        onSave={vi.fn()}
      />,
    );

    expect(select().value).toBe("AG1");
    expect(selectedName()).toBe("AG1");
  });

  it("offers every custom group a stock craft has, so each can be chosen", () => {
    render(
      <ActionGroupConfigForm
        config={{} as ActionGroupConfig}
        onSave={vi.fn()}
      />,
    );

    const values = Array.from(select().options, (o) => o.value);
    for (let n = 1; n <= 10; n++) expect(values).toContain(`AG${n}`);
  });

  it("keeps a saved group the list does not otherwise hold", () => {
    render(
      <ActionGroupConfigForm
        config={{ actionGroupId: "AG14" }}
        onSave={vi.fn()}
      />,
    );

    expect(select().value).toBe("AG14");
    expect(selectedName()).toBe("AG14");
  });
});
