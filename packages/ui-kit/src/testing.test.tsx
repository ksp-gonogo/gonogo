import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { unitMatchers, visibleText } from "./testing";
import { render } from "./testing-react";
import { Unit } from "./Unit";

expect.extend(unitMatchers);

declare module "vitest" {
  interface Assertion<T = unknown> {
    toShowQuantity(
      quantity: { magnitude: number; unit: string } | null | undefined,
    ): T;
  }
}

/**
 * The Uplink author's path, exercised as an Uplink author would hit it.
 *
 * These helpers exist because `<Unit>` splits a readout into a number, a
 * symbol and a hidden word, so the obvious assertion finds nothing. The first
 * test pins that surprise rather than describing it, so the helpers cannot
 * quietly stop being necessary (or stop working) without this failing.
 */
describe("@ksp-gonogo/ui-kit/testing", () => {
  it("is needed: a readout is not one text node", () => {
    const { container } = render(<Unit value={value("m", 12400)} />);
    // What an author reaches for first, and why it does not work. The
    // separator is spelled \u2009 here deliberately: typing an ordinary space
    // produces `expected "12.4 km kilometres" to be "12.4 km kilometres"`,
    // which is the exact confusion `visibleText` exists to end.
    expect(container.textContent).toBe("12.4\u2009km kilometres");
    expect(
      [...container.querySelectorAll("*")].some(
        (el) => el.textContent === "12.4\u2009km",
      ),
    ).toBe(false);
  });

  it("visibleText reads what a sighted reader sees", () => {
    const { container } = render(<Unit value={value("m", 12400)} />);
    expect(visibleText(container)).toBe("12.4 km");
  });

  it("normalises the thin space so an expectation can be typed", () => {
    const { container } = render(<Unit value={value("m", 12400)} />);
    // The rendered separator is U+2009; the assertion above uses a plain
    // space and passes, which is the whole point of the normalisation.
    expect(container.textContent).toContain(" ");
    expect(visibleText(container)).not.toContain(" ");
  });

  it("toShowQuantity asserts the quantity, not its spelling", () => {
    const { container } = render(<Unit value={value("m", 12400)} />);
    // 12400 metres, however this kit decides to spell it.
    expect(container).toShowQuantity(value("m", 12400));
    expect(container).not.toShowQuantity(value("m", 999));
  });

  it("follows the ladder, so a rung change does not break the test", () => {
    // The same distance either side of the metres/kilometres handoff. A
    // literal expectation has to name which rung it lands on; this does not.
    const near = render(<Unit value={value("m", 940)} />);
    expect(near.container).toShowQuantity(value("m", 940));
    const far = render(<Unit value={value("m", 94000)} />);
    expect(far.container).toShowQuantity(value("m", 94000));
    // And they genuinely render differently, so the test above is not vacuous.
    expect(visibleText(near.container)).not.toBe(visibleText(far.container));
  });

  it("reports what a reader saw when it fails", () => {
    const { container } = render(<Unit value={value("m", 12400)} />);
    const result = unitMatchers.toShowQuantity(container, value("m", 5));
    expect(result.pass).toBe(false);
    expect(result.message()).toContain("12.4 km");
  });
});
