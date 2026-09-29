import { render, screen, within } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ComboboxListbox, type ComboboxOption } from "./Combobox";
import { emittedRuleFor } from "./test/emittedRule";

const OPTIONS: ComboboxOption[] = [
  { key: "alt", label: "Altitude", group: "Vessel" },
  { key: "ap", label: "Apoapsis", group: "Vessel" },
  { key: "pe", label: "Periapsis", group: "Orbit" },
];

function renderListbox(activeIndex = 1, selectedKey?: string) {
  return render(
    <div>
      <input
        role="combobox"
        aria-label="Data key"
        aria-controls="lb"
        aria-expanded="true"
      />
      <ComboboxListbox
        id="lb"
        groups={[
          ["Vessel", OPTIONS.slice(0, 2)],
          ["Orbit", OPTIONS.slice(2)],
        ]}
        flatOptions={OPTIONS}
        activeIndex={activeIndex}
        selectedKey={selectedKey}
        getOptionId={(k) => `opt-${k}`}
        onHoverIndex={() => {}}
        onSelectKey={() => {}}
        ariaLabel="Data keys"
      />
    </div>,
  );
}

describe("ComboboxListbox", () => {
  it("names each group of options for assistive tech", () => {
    renderListbox();
    const vessel = screen.getByRole("group", { name: "Vessel" });
    expect(within(vessel).getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Orbit" })).toBeInTheDocument();
  });

  it("marks the highlighted option with the focus colour, not a near-invisible background", () => {
    renderListbox(1);
    const active = screen.getByRole("option", { name: "Apoapsis" });
    expect(emittedRuleFor(active)).toContain("var(--color-focus)");
  });

  it("draws the committed option on the go status fill with every text level in its on-status text", () => {
    renderListbox(0, "pe");
    const rule = emittedRuleFor(
      screen.getByRole("option", { name: "Periapsis" }),
    );
    expect(rule).toContain("background:var(--color-go-status)");
    for (const level of [
      "neutral-text",
      "text-primary",
      "text-muted",
      "text-dim",
      "text-faint",
    ]) {
      expect(rule).toContain(`--color-${level}:var(--color-go-on-status)`);
    }
  });

  it("has no axe violations", async () => {
    const { container } = renderListbox();
    await expectNoA11yViolations(container);
  });
});
