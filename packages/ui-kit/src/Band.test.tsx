import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Band, INTERVAL_DASH } from "./Band";
import { NULL_DISPLAY } from "./NullValue";

describe("Band", () => {
  /**
   * The failure this widens digits for: both ends land on the megametre rung,
   * a length's default single decimal prints each as `6.7 Mm`, and an interval
   * renders as a scalar exactly where its width was the point.
   */
  it("widens the digits until the two ends read differently", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_710_000)} />,
    );
    expect(container.textContent).toContain("6.70");
    expect(container.textContent).toContain("6.71");
    expect(container.textContent).toContain("Mm");
  });

  /**
   * The same failure from the other side, and the one a narrow reckoned band
   * walks into. A one-sigma interval of 47.471 to 47.529 units prints `47.5`
   * twice at the kind's default single decimal, and `47` and `48` at NO
   * decimals, which separates. Taking the coarser count because it happened to
   * separate would state an interval seventeen times the width the model was
   * prepared to defend.
   */
  it("widens rather than coarsens when a coarser count would also separate", () => {
    const { container } = render(
      <Band
        min={value("units", 47.471_132_486_540_52)}
        max={value("units", 47.528_867_513_459_48)}
      />,
    );
    expect(container.textContent).toContain("47.47");
    expect(container.textContent).toContain("47.53");
    expect(container.textContent).not.toContain("48 units");
  });

  /**
   * The bug that motivated the unit scale: two ends either side of a rung
   * boundary ladder independently, and one interval comes out written in two
   * units, with a width the reader has to convert before they can see it.
   */
  it("writes both ends in one unit when they straddle a rung boundary", () => {
    const { container } = render(
      <Band min={value("m", 999)} max={value("m", 1000)} />,
    );
    // The larger end's rung, and a band separates its own two ends, so the
    // digits come back to say what the shared kilometres would have flattened.
    expect(container.textContent).toContain("0.999");
    expect(container.textContent).toContain("1.000");
    expect(screen.queryAllByText("kilometres")).toHaveLength(2);
  });

  it("leaves the kind's own precision alone when the ends already differ", () => {
    const { container } = render(
      <Band min={value("m", 1200)} max={value("m", 8400)} />,
    );
    expect(container.textContent).toContain("1.2");
    expect(container.textContent).toContain("8.4");
  });

  /**
   * An element that did not move over the window should print as one figure
   * twice, not as six decimals of noise nobody can read.
   */
  it("does not widen a band of zero width", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_700_000)} />,
    );
    expect(container.textContent).not.toContain("6.7000");
  });

  /**
   * The operator's rule, 2026-09-15: "anytime we'd shown the same numbers on
   * each side, we show a single value with a tilde instead". Two ends that
   * come out as the same text offer a width and then print none, and the
   * reader cannot see the difference they are being shown.
   */
  it("draws ONE approximate figure when both ends would print the same text", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_700_000)} />,
    );

    expect(container.textContent).toContain("~");
    expect(container.textContent).not.toContain(INTERVAL_DASH);
    // Once, not twice: the whole point is that the second figure said nothing.
    expect(container.textContent?.match(/6\.7/g)).toHaveLength(1);
  });

  /**
   * The same rendering for float residue, which is what the ladder's floor
   * (#253) already treats as indistinguishable. Two ends one ULP apart are
   * genuinely different doubles and no decimal count here can show it, so the
   * rule catches them without naming them as a case.
   */
  it("draws one approximate figure for ends a single ULP apart", () => {
    const nextAfter = (v: number): number => {
      const buf = new Float64Array([v]);
      new BigUint64Array(buf.buffer)[0] += 1n;
      return buf[0];
    };
    const low = 65_286.8;

    const { container } = render(
      <Band min={value("m", low)} max={value("m", nextAfter(low))} />,
    );

    expect(container.textContent).toContain("~");
    expect(container.textContent).not.toContain(INTERVAL_DASH);
    expect(container.textContent).not.toContain("65.286800");
  });

  it.each([
    ["format", { format: "km" }],
    ["as", { as: "km" }],
    ["decimals", { decimals: 1 }],
  ] as const)("draws one approximate figure for equal ends under a pinned %s", (_pin, pins) => {
    const { container } = render(
      <Band min={value("m", 65_300)} max={value("m", 65_300)} {...pins} />,
    );

    expect(container.textContent).toContain("~");
    expect(container.textContent).not.toContain(INTERVAL_DASH);
    expect(container.textContent?.match(/65\.3/g)).toHaveLength(1);
  });

  it("still widens the digits of a pinned band until its ends read apart", () => {
    const { container } = render(
      <Band min={value("m", 65_300)} max={value("m", 65_340)} format="km" />,
    );

    expect(container.textContent).not.toContain("~");
    expect(container.textContent).toContain("65.30");
    expect(container.textContent).toContain("65.34");
  });

  it("leaves a band whose ends print differently completely alone", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_710_000)} />,
    );

    expect(container.textContent).not.toContain("~");
    expect(container.textContent).toContain("6.70");
    expect(container.textContent).toContain("6.71");
  });

  /**
   * The mark is a mark: a screen reader announcing "tilde" is not what a
   * sighted reader takes from it, so the tilde is hidden and the word beside
   * it is what is spoken.
   */
  it("says the approximation in words for the accessibility tree", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_700_000)} />,
    );

    expect(container.textContent).toContain("approximately");
    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden?.textContent).toBe("~");
  });

  /**
   * One end alone reads as a scalar, and a scalar is the one thing an operator
   * must not take away from an interval whose other end could not be read.
   */
  it("shows a half-read band as absent rather than as a number", () => {
    const { container } = render(<Band min={value("m", 100)} max={null} />);
    expect(container.textContent).toBe(NULL_DISPLAY);
  });

  it("shows nothing at all as absent", () => {
    const { container } = render(<Band />);
    expect(container.textContent).toBe(NULL_DISPLAY);
  });

  /**
   * A circular quantity spanning half the turn or more has no interval left:
   * every value is inside it, and `0° - 359°` states the opposite of what is
   * true. The renderer decides this, not the caller, because three different
   * formatters would otherwise each have to know the rule.
   */
  it("says a modular quantity precessed instead of printing a full turn", () => {
    render(<Band min={value("°", 0)} max={value("°", 359)} wrapsAt={360} />);
    expect(screen.getByText("(precesses)")).toBeInTheDocument();
  });

  it("keeps a narrow modular band as an interval", () => {
    const { container } = render(
      <Band min={value("°", 44)} max={value("°", 46)} wrapsAt={360} />,
    );
    expect(container.textContent).not.toContain("precesses");
    expect(container.textContent).toContain("44");
    expect(container.textContent).toContain("46");
  });
});

describe("Band read aloud", () => {
  it("joins its two ends with a word, since the dash between them is silent", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_900_000)} />,
    );
    expect(container.textContent).toMatch(/ to /);
  });
});
