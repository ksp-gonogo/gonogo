import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Band, INTERVAL_DASH } from "./Band";
import { NULL_DISPLAY } from "./NullValue";

describe("Band", () => {
  // At a length's default single decimal both ends would print `6.7 Mm`.
  it("widens the digits until the two ends read differently", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_710_000)} />,
    );
    expect(container.textContent).toContain("6.70");
    expect(container.textContent).toContain("6.71");
    expect(container.textContent).toContain("Mm");
  });

  // `47` to `48` also separates, but states an interval far wider than the model claims.
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

  it("writes both ends in one unit when they straddle a rung boundary", () => {
    const { container } = render(
      <Band min={value("m", 999)} max={value("m", 1000)} />,
    );
    // Both on the larger end's rung, with digits widened so the ends still differ.
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

  it("does not widen a band of zero width", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_700_000)} />,
    );
    expect(container.textContent).not.toContain("6.7000");
  });

  it("draws ONE approximate figure when both ends would print the same text", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_700_000)} />,
    );

    expect(container.textContent).toContain("~");
    expect(container.textContent).not.toContain(INTERVAL_DASH);
    expect(container.textContent?.match(/6\.7/g)).toHaveLength(1);
  });

  // Two ends one ULP apart are different doubles that no decimal count can show apart.
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

  it("says the approximation in words for the accessibility tree", () => {
    const { container } = render(
      <Band min={value("m", 6_700_000)} max={value("m", 6_700_000)} />,
    );

    expect(container.textContent).toContain("approximately");
    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden?.textContent).toBe("~");
  });

  // One end alone would read as a scalar.
  it("shows a half-read band as absent rather than as a number", () => {
    const { container } = render(<Band min={value("m", 100)} max={null} />);
    expect(container.textContent).toBe(NULL_DISPLAY);
  });

  it("shows nothing at all as absent", () => {
    const { container } = render(<Band />);
    expect(container.textContent).toBe(NULL_DISPLAY);
  });

  // Spanning half the turn or more, every angle is inside the band, so there is no interval left.
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
