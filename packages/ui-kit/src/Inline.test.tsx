import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Inline } from "./Inline";

describe("Inline", () => {
  it("renders its children", () => {
    render(
      <Inline>
        <span>DATA</span>
        <span>DEPLOYED</span>
      </Inline>,
    );
    expect(screen.getByText("DATA")).toBeInTheDocument();
    expect(screen.getByText("DEPLOYED")).toBeInTheDocument();
  });

  it("is one unbreakable run that never yields width, by default", () => {
    render(<Inline data-testid="badges">DATA</Inline>);
    const style = getComputedStyle(screen.getByTestId("badges"));
    expect(style.flexShrink).toBe("0");
    expect(style.flexWrap).not.toBe("wrap");
  });

  /**
   * The shrink half matters as much as the wrap: a cluster pinned at
   * `flex-shrink: 0` is never narrow enough to need a second line, so it runs
   * on past its container and paints over whatever is drawn beside it.
   */
  it("breaks onto further lines, and gives up width to do it, when asked", () => {
    render(
      <Inline wrap data-testid="badges">
        DATA
      </Inline>,
    );
    const style = getComputedStyle(screen.getByTestId("badges"));
    expect(style.flexWrap).toBe("wrap");
    expect(style.flexShrink).toBe("1");
    expect(style.minWidth).toBe("0px");
  });
});
