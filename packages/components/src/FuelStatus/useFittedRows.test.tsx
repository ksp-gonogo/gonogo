import { render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFittedRows } from "./useFittedRows";

const ROW_PX = 40;
const HEAD_PX = 30;
const BLOCK_TOP = 100;

/** The layout jsdom lacks: a body of the given height, a block 100px down it, and a list of rows 40px tall under a 30px heading. */
function stubLayout(bodyHeight: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const box = (top: number, height: number) =>
        ({
          top,
          height,
          bottom: top + height,
          left: 0,
          right: 0,
          width: 0,
          x: 0,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect;
      if (this.hasAttribute("data-panel-body")) return box(0, bodyHeight);
      if (this.hasAttribute("data-list")) {
        return box(BLOCK_TOP + HEAD_PX, this.childElementCount * ROW_PX);
      }
      if (this.hasAttribute("data-block")) return box(BLOCK_TOP, 0);
      return box(0, 0);
    },
  );
}

const rowIds = (n: number) => ["a", "b", "c", "d", "e", "f"].slice(0, n);

function Rows({ count }: { count: number }) {
  const { blockRef, listRef, fitted, noteFits } = useFittedRows(count);
  const shown = fitted === null ? count : fitted;
  return (
    <div data-panel-body="">
      <div ref={blockRef} data-block="">
        {fitted !== 0 && (
          <div ref={listRef} data-list="">
            {rowIds(shown).map((id) => (
              <span key={id}>row</span>
            ))}
          </div>
        )}
      </div>
      <output>
        {fitted === null ? "all" : String(fitted)}
        {noteFits ? " note" : " no note"}
      </output>
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useFittedRows", () => {
  it("draws every row when the body has room for them all", () => {
    stubLayout(400);
    render(<Rows count={5} />);
    expect(screen.getByRole("status")).toHaveTextContent("all note");
  });

  it("draws the rows that fit, leaving a row's height for the count of the rest", () => {
    // 300 - 100 - 30 = 170px: three rows and the line that counts the other two.
    stubLayout(300);
    render(<Rows count={5} />);
    expect(screen.getByRole("status")).toHaveTextContent("3 note");
  });

  it("draws the first row whenever there is room for it, without the count where that has none", () => {
    // 50px: one row of 40 and not the 20px line that counts the rest.
    stubLayout(180);
    render(<Rows count={5} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 no note");
  });

  it("draws none of the block when not even one row fits beside its heading", () => {
    stubLayout(150);
    render(<Rows count={5} />);
    expect(screen.getByRole("status")).toHaveTextContent("0");
  });
});
