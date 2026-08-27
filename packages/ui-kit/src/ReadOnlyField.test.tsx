import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "./expectNoA11yViolations";
import { NULL_DISPLAY } from "./NullValue";
import { ReadOnlyField } from "./ReadOnlyField";

describe("ReadOnlyField", () => {
  it("pairs the label with the value as a term and its definition", () => {
    render(<ReadOnlyField label="Plotting frame" value="Kerbin-centred" />);

    const term = screen.getByText("Plotting frame");
    expect(term.closest("dt")).not.toBeNull();
    const definition = screen.getByText("Kerbin-centred");
    expect(definition.closest("dd")).not.toBeNull();
    // The pairing is programmatic: both sit inside the same list, so a reader
    // in browse mode gets one item rather than two adjacent strings.
    expect(term.closest("dl")).toBe(definition.closest("dl"));
  });

  it("lets a sentence wrap and holds a quantity on one line", () => {
    // A read-only row's value is a health reason or a build string as often as
    // it is a number. `nowrap` is right for the second (a quantity must never
    // break between its number and its symbol) and squeezes the label beside
    // the first into a ribbon two words wide, which is what this render showed.
    const { container: prose } = render(
      <ReadOnlyField
        label="Why reading stopped"
        value="The mod is recording a journal; reading it would write us into the recording"
      />,
    );
    const proseValue = prose.querySelector("dd");
    if (proseValue === null) throw new Error("no dd");
    expect(getComputedStyle(proseValue).whiteSpace).toBe("normal");

    const { container: quantity } = render(
      <ReadOnlyField label="Prediction tolerance" value={value("m", 1)} />,
    );
    const quantityValue = quantity.querySelector("dd");
    if (quantityValue === null) throw new Error("no dd");
    expect(getComputedStyle(quantityValue).whiteSpace).toBe("nowrap");
  });

  it("renders no control at all, disabled or otherwise", () => {
    const { container } = render(
      <ReadOnlyField label="Prediction tolerance" value={value("m", 1)} />,
    );

    // The whole point of the component. A disabled input would be skipped by
    // some screen readers, and this is data rather than a dead control.
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[aria-disabled]")).toBeNull();
  });

  it("announces a quantity's unit as a word beside its symbol", () => {
    render(
      <ReadOnlyField label="Prediction tolerance" value={value("m", 1)} />,
    );

    // `Unit` hides the symbol from the accessibility tree and puts the word
    // there instead, so the accessible name of the pair says "metres".
    expect(screen.getByText("m")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(/metres/)).toBeInTheDocument();
  });

  it("shows a flag as a state rather than as a serialisation", () => {
    render(<ReadOnlyField label="Declutter" value={false} />);
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.queryByText("false")).toBeNull();
  });

  it("shows the null placeholder when the value has not arrived", () => {
    render(<ReadOnlyField label="Build" value={undefined} />);
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("keeps the description with the term it describes", () => {
    render(
      <ReadOnlyField
        label="Prediction tolerance"
        description="What the integrator was told to hold to."
        value={value("m", 1)}
      />,
    );
    const description = screen.getByText(
      "What the integrator was told to hold to.",
    );
    expect(description.closest("dt")).not.toBeNull();
  });

  it("passes the a11y smoke assertion", async () => {
    const { container } = render(
      <ReadOnlyField
        label="Prediction tolerance"
        description="What the integrator was told to hold to."
        value={value("m", 1)}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
