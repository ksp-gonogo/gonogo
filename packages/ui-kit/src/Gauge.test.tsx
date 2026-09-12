import { value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Gauge } from "./Gauge";

/** A thrust-to-weight ratio, the gauge's first and canonical subject. */
const twr = (n: number) => value("1", n);

describe("Gauge", () => {
  it("renders the value as the centre label by default", () => {
    const { container } = render(
      <Gauge
        value={twr(1.5)}
        min={twr(0)}
        max={twr(3)}
        width={200}
        height={120}
      />,
    );
    expect(container.textContent).toContain("1.5");
  });

  it("writes the value's own unit beside it, with no unit prop to disagree", () => {
    const { container } = render(
      <Gauge
        value={value("kN", 42)}
        min={value("kN", 0)}
        max={value("kN", 100)}
        width={200}
        height={120}
      />,
    );
    expect(container.textContent).toContain("42");
    expect(container.textContent).toContain("kN");
  });

  it("speaks the value with its unit in the accessible name", () => {
    const { container } = render(
      <Gauge
        value={value("kN", 42)}
        min={value("kN", 0)}
        max={value("kN", 100)}
        width={200}
        height={120}
      />,
    );
    expect(
      container.querySelector("svg")?.getAttribute("aria-label"),
    ).toContain("kilonewton");
  });

  it("uses the supplied valueLabel when provided", () => {
    const { container } = render(
      <Gauge
        value={twr(1.5)}
        min={twr(0)}
        max={twr(3)}
        width={200}
        height={120}
        valueLabel="LIFTOFF"
      />,
    );
    expect(container.textContent).toContain("LIFTOFF");
  });

  it("renders one path per zone plus the track", () => {
    const { container } = render(
      <Gauge
        value={twr(1.5)}
        min={twr(0)}
        max={twr(3)}
        width={200}
        height={120}
        zones={[
          { from: twr(0), to: twr(1), color: "red" },
          { from: twr(1), to: twr(1.5), color: "orange" },
          { from: twr(1.5), to: twr(3), color: "green" },
        ]}
      />,
    );
    expect(container.querySelectorAll("path")).toHaveLength(4); // 1 track + 3 zones
  });

  it("clamps values outside [min, max] to the bounds", () => {
    // value above max should still render without throwing; needle pinned to max
    const { container } = render(
      <Gauge
        value={twr(99)}
        min={twr(0)}
        max={twr(3)}
        width={200}
        height={120}
      />,
    );
    expect(container.querySelector("line")).not.toBeNull();
  });

  it("renders an empty SVG gracefully when too small", () => {
    const { container } = render(
      <Gauge value={twr(1)} min={twr(0)} max={twr(3)} width={4} height={4} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelector("path")).toBeNull();
  });

  it("uses the supplied aria-label", () => {
    const { container } = render(
      <Gauge
        value={twr(2)}
        min={twr(0)}
        max={twr(3)}
        width={200}
        height={120}
        ariaLabel="TWR dial"
      />,
    );
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      "TWR dial",
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Gauge
        value={twr(1.5)}
        min={twr(0)}
        max={twr(3)}
        width={200}
        height={120}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
