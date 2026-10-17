import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { ContainerBreak } from "./ContainerBreak";
import { SquareCell, SquareGrid, squareGridChoices } from "./SquareGrid";

/** Every styled-components rule the render injected, as one string. */
function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent)
    .join("\n");
}

describe("SquareGrid", () => {
  it("offers only the column counts that save a row", () => {
    expect(squareGridChoices(3)).toEqual([
      { cols: 1, rows: 3 },
      { cols: 2, rows: 2 },
      { cols: 3, rows: 1 },
    ]);
    expect(squareGridChoices(4)).toEqual([
      { cols: 1, rows: 4 },
      { cols: 2, rows: 2 },
      { cols: 4, rows: 1 },
    ]);
  });

  it("draws one cell per child, each a heading row over a square", () => {
    const { container } = render(
      <SquareGrid headingPx={17}>
        <SquareCell heading="First">a</SquareCell>
        <SquareCell heading="Second">b</SquareCell>
      </SquareGrid>,
    );
    const cells = container.querySelectorAll("[data-square-cell]");
    expect(cells).toHaveLength(2);
    expect(cells[0].querySelector("[data-square-heading]")).toHaveTextContent(
      "First",
    );
    expect(cells[0].querySelector("[data-square]")).toHaveTextContent("a");
  });

  it("renders nothing with no cells", () => {
    const { container } = render(<SquareGrid />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lets a container replace the height it asks for", () => {
    render(
      <SquareGrid>
        <SquareCell>a</SquareCell>
      </SquareGrid>,
    );
    expect(injectedCss()).toContain("min-height:var(--square-grid-height,");
  });

  it("caps a floor square at the height of the size container it sits in", () => {
    render(
      <SquareGrid floorPx={200} minColumnPx={200}>
        <SquareCell>a</SquareCell>
      </SquareGrid>,
    );
    expect(injectedCss()).toMatch(
      /--cell-floor-drawn:min\(var\(--cell-floor\),\s*200px,\s*100cqh/,
    );
  });
});

describe("ContainerBreak", () => {
  it("switches at an aspect ratio of a container sized in both axes", () => {
    render(
      <ContainerBreak atAspect={2.5} wide={{ display: "grid" }}>
        x
      </ContainerBreak>,
    );
    expect(injectedCss()).toMatch(/@container \(aspect-ratio >= 2\.5\)/);
  });

  it("needs both breakpoints when given both", () => {
    render(
      <ContainerBreak at={300} atAspect={2} wide={{ display: "grid" }}>
        x
      </ContainerBreak>,
    );
    expect(injectedCss()).toMatch(
      /@container \(min-width: 300px\) and \(aspect-ratio >= 2\)/,
    );
  });
});
