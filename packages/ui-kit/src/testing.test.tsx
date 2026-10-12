import { value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { type UnitMatchers, unitMatchers, visibleText } from "./testing";
import { Unit } from "./Unit";

expect.extend(unitMatchers);

// The merge documented on `UnitMatchers`, not a hand-written copy of the signature.
declare module "vitest" {
  interface Assertion<T> extends UnitMatchers<T> {}
}

/** The Uplink author's path. The first test pins why the helpers are needed, so it fails if they stop being. */
describe("@ksp-gonogo/ui-kit/testing", () => {
  it("is needed: a readout is not one text node", () => {
    const { container } = render(<Unit value={value("m", 12400)} />);
    // The separator is a thin space, spelled \u2009 so the expectation is legible.
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
    expect(container.textContent).toContain(" ");
    expect(visibleText(container)).not.toContain(" ");
  });

  it("toShowQuantity asserts the quantity, not its spelling", () => {
    const { container } = render(<Unit value={value("m", 12400)} />);
    expect(container).toShowQuantity(value("m", 12400));
    expect(container).not.toShowQuantity(value("m", 999));
  });

  it("follows the ladder, so a rung change does not break the test", () => {
    // Either side of the metres/kilometres handoff.
    const near = render(<Unit value={value("m", 940)} />);
    expect(near.container).toShowQuantity(value("m", 940));
    const far = render(<Unit value={value("m", 94000)} />);
    expect(far.container).toShowQuantity(value("m", 94000));
    // They render differently, so the test above is not vacuous.
    expect(visibleText(near.container)).not.toBe(visibleText(far.container));
  });

  it("reports what a reader saw when it fails", () => {
    const { container } = render(<Unit value={value("m", 12400)} />);
    const result = unitMatchers.toShowQuantity(container, value("m", 5));
    expect(result.pass).toBe(false);
    expect(result.message()).toContain("12.4 km");
  });
});
