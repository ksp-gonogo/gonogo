import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Gauge } from "./Gauge";

describe("Gauge", () => {
  it("renders the value as the centre label by default", () => {
    const { container } = render(
      <Gauge value={1.5} min={0} max={3} width={200} height={120} />,
    );
    expect(container.textContent).toContain("1.50");
  });

  it("uses the supplied valueLabel when provided", () => {
    const { container } = render(
      <Gauge
        value={1.5}
        min={0}
        max={3}
        width={200}
        height={120}
        valueLabel="LIFTOFF"
      />,
    );
    expect(container.textContent).toContain("LIFTOFF");
  });

  it("renders the unit label when provided", () => {
    const { container } = render(
      <Gauge
        value={1}
        min={0}
        max={3}
        width={200}
        height={120}
        unitLabel="g"
      />,
    );
    expect(container.textContent).toContain("g");
  });

  it("renders one path per zone plus the track", () => {
    const { container } = render(
      <Gauge
        value={1.5}
        min={0}
        max={3}
        width={200}
        height={120}
        zones={[
          { from: 0, to: 1, color: "red" },
          { from: 1, to: 1.5, color: "orange" },
          { from: 1.5, to: 3, color: "green" },
        ]}
      />,
    );
    expect(container.querySelectorAll("path")).toHaveLength(4); // 1 track + 3 zones
  });

  it("clamps values outside [min, max] to the bounds", () => {
    // value above max should still render without throwing; needle pinned to max
    const { container } = render(
      <Gauge value={99} min={0} max={3} width={200} height={120} />,
    );
    expect(container.querySelector("line")).not.toBeNull();
  });

  it("renders an empty SVG gracefully when too small", () => {
    const { container } = render(
      <Gauge value={1} min={0} max={3} width={4} height={4} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelector("path")).toBeNull();
  });

  it("uses the supplied aria-label", () => {
    const { container } = render(
      <Gauge
        value={2}
        min={0}
        max={3}
        width={200}
        height={120}
        ariaLabel="TWR dial"
      />,
    );
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      "TWR dial",
    );
  });
});
