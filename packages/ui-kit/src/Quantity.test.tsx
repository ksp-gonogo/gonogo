import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Quantity } from "./Quantity";
import { speakQuantity } from "./units";

/**
 * `Quantity` exists because eleven call sites took `formatQuantity`'s two
 * parts and joined them into a string, which threw away the styling and the
 * spoken word the split was there to enable. These tests pin the parts staying
 * apart.
 */
describe("Quantity", () => {
  it("renders the value with its unit as a separate, resolved element", () => {
    // Asserted as two halves rather than as one textContent, because the two
    // halves are the point: the symbol is what a reader SEES (aria-hidden, so
    // it is not announced) and the word is what a screen reader HEARS.
    const { container } = render(<Quantity value={12_400} unit="m" />);
    const unit = container.querySelector("[data-unit]");
    expect(unit?.getAttribute("data-unit")).toBe("km");
    expect(unit?.querySelector("[aria-hidden]")?.textContent).toBe("km");
    expect(container.textContent).toBe("12.4km kilometres");
  });

  it("climbs the ladder and announces the rung it reached", () => {
    const { container } = render(<Quantity value={3_400_000} unit="m" />);
    expect(container.textContent).toBe("3.4Mm megametres");
  });

  it("passes options through to the formatter", () => {
    const { container } = render(
      <Quantity value={5432} unit="m" decimals={3} />,
    );
    expect(container.textContent).toBe("5.432km kilometres");
  });

  it("renders no unit for a duration, whose parts are already interleaved", () => {
    // formatQuantity returns "2h 14m" with an EMPTY symbol but a rung of "s".
    // Rendering the rung would print a stray "s" beside a formatted duration,
    // which is why this reads `symbol` rather than `rung`.
    const { container } = render(<Quantity value={8048} unit="s" />);
    expect(container.textContent).toBe("2h 14m");
    expect(container.querySelector("[data-unit]")).toBeNull();
  });

  it("renders no unit beside an absent value", () => {
    const { container } = render(<Quantity value={Number.NaN} unit="m" />);
    expect(container.querySelector("[data-unit]")).toBeNull();
  });

  it("shows a currency's symbol and announces its name", () => {
    const { container } = render(<Quantity value={12_450} unit="funds" />);
    // Funds are whole: the kind sets zero decimals.
    expect(container.textContent).toBe("12450f funds");
  });
});

describe("speakQuantity", () => {
  it("uses the word, which is the whole point of it", () => {
    // An aria-label built by interpolating a formatted string announces
    // "two fifty point zero kay em". This is the string form that does not.
    expect(speakQuantity(250_000, "m")).toBe("250.0 kilometres");
  });

  it("falls back to the symbol for a unit with no word", () => {
    expect(speakQuantity(3, "qz")).toBe("3 qz");
  });

  it("omits a unit that has nothing to say", () => {
    expect(speakQuantity(8048, "s")).toBe("2h 14m");
  });
});
