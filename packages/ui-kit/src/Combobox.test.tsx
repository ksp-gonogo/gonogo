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

function renderListbox(activeIndex = 1) {
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

  it("has no axe violations", async () => {
    const { container } = renderListbox();
    await expectNoA11yViolations(container);
  });
});
