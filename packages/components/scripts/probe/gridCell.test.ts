// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GRID_CELL_HEADER_PX, GRID_CELL_WRAPPER_CSS } from "./gridCell";

/**
 * The harness's copy of the dashboard cell is only worth anything while it
 * matches the cell the operator sees. A header that grew, or a wrapper that
 * stopped clipping, would leave every tile render measuring a cell that no
 * longer exists, and nothing else would say so.
 */

const DASHBOARD = resolve(
  import.meta.dirname,
  "../../../app/src/components/Dashboard",
);

/** The body of one styled-components template literal, by its binding name. */
function styledBody(file: string, name: string): string {
  const source = readFileSync(resolve(DASHBOARD, file), "utf8");
  const match = new RegExp(`const ${name} = styled\\.div\`([\\s\\S]*?)\``).exec(
    source,
  );
  if (!match) throw new Error(`${name} is no longer a styled.div in ${file}`);
  return match[1];
}

describe("the harness's dashboard cell", () => {
  it("has the drag header's height", () => {
    expect(styledBody("GridItemContent.tsx", "CellHeader")).toMatch(
      new RegExp(`\\bheight:\\s*${GRID_CELL_HEADER_PX}px;`),
    );
  });

  it("gives the widget the wrapper's box", () => {
    const wrapper = styledBody("shared.tsx", "ComponentWrapper");
    expect(wrapper).toMatch(
      new RegExp(`flex:\\s*${GRID_CELL_WRAPPER_CSS.flex};`),
    );
    expect(wrapper).toMatch(
      new RegExp(`min-height:\\s*${GRID_CELL_WRAPPER_CSS.minHeight};`),
    );
    expect(wrapper).toMatch(
      new RegExp(`overflow:\\s*${GRID_CELL_WRAPPER_CSS.overflow};`),
    );
  });

  it("is a clipping column, as the grid cell is", () => {
    const cell = styledBody("GridDashboard.tsx", "GridCell");
    expect(cell).toMatch(/display:\s*flex;/);
    expect(cell).toMatch(/flex-direction:\s*column;/);
    expect(cell).toMatch(/overflow:\s*hidden;/);
  });
});
