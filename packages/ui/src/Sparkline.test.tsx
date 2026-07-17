import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders nothing for fewer than 2 finite values", () => {
    const { container } = render(
      <Sparkline values={[]} width={100} height={20} />,
    );
    expect(container.querySelector("path")).toBeNull();
  });

  it("draws a path for two or more finite values", () => {
    const { container } = render(
      <Sparkline values={[1, 2, 3, 4]} width={100} height={20} />,
    );
    const path = container.querySelector("path");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("d")).toMatch(/M.*L/);
  });

  it("filters out non-finite values defensively", () => {
    const { container } = render(
      <Sparkline values={[1, NaN, 2, Infinity, 3]} width={100} height={20} />,
    );
    expect(container.querySelector("path")).not.toBeNull();
  });

  it("renders a zero baseline when requested and 0 is in range", () => {
    const { container } = render(
      <Sparkline
        values={[-5, 0, 5]}
        width={100}
        height={20}
        showZeroBaseline
      />,
    );
    expect(container.querySelectorAll("line")).toHaveLength(1);
  });

  it("omits the baseline when 0 falls outside the data range", () => {
    const { container } = render(
      <Sparkline
        values={[10, 20, 30]}
        width={100}
        height={20}
        showZeroBaseline
      />,
    );
    expect(container.querySelectorAll("line")).toHaveLength(0);
  });

  it("uses the supplied yDomain when provided", () => {
    const { container } = render(
      <Sparkline
        values={[5, 5, 5]}
        width={100}
        height={20}
        yDomain={[0, 10]}
      />,
    );
    // Flat line in the middle of [0,10] → all y ≈ height/2
    const d = container.querySelector("path")?.getAttribute("d") ?? "";
    expect(d).toContain("10.00");
  });

  it("renders a 0×0 svg gracefully when width/height are non-positive", () => {
    const { container } = render(
      <Sparkline values={[1, 2, 3]} width={0} height={0} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("exposes its aria-label", () => {
    const { container } = render(
      <Sparkline
        values={[1, 2]}
        width={100}
        height={20}
        ariaLabel="TWR trend"
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe("TWR trend");
  });
});
