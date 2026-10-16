import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** The height of the line that counts the rows left out, as a share of one row. */
const NOTE_ROWS = 0.5;

/**
 * How many of `count` uniform rows the panel body has room for below the top of
 * the block that holds them, so a tile too short for every row draws the first
 * rows that fit and says how many are left out. `null` means every row fits, or
 * nothing has been laid out yet, and `0` means not even one row fits beside its
 * heading, so the caller draws none of the block. The first row is drawn
 * whenever there is room for it, even where the line counting the rows left
 * out is not, which `noteFits` reports.
 *
 * The heading's height and one row's height are read once with every row
 * drawn; after that the room comes from the panel body alone, so the answer
 * does not depend on how many rows are currently drawn.
 */
export function useFittedRows(count: number): {
  blockRef: (el: HTMLDivElement | null) => void;
  listRef: (el: HTMLDivElement | null) => void;
  fitted: number | null;
  noteFits: boolean;
} {
  const [fitted, setFitted] = useState<number | null>(null);
  const [noteFits, setNoteFits] = useState(true);
  const blockEl = useRef<HTMLDivElement | null>(null);
  const listEl = useRef<HTMLDivElement | null>(null);
  const sizes = useRef({ count, head: 0, row: 0 });
  if (sizes.current.count !== count) {
    sizes.current = { count, head: 0, row: 0 };
  }

  const measure = useCallback(() => {
    const block = blockEl.current;
    const list = listEl.current;
    const body = block?.closest<HTMLElement>("[data-panel-body]");
    if (!block || !body || count === 0) return;
    const bodyBox = body.getBoundingClientRect();
    if (bodyBox.height === 0) return;
    const known = sizes.current;
    if (known.row === 0) {
      if (fitted !== null) {
        // Rows were left out before a row's height was known: draw them all to find it.
        setFitted(null);
        return;
      }
      if (!list) return;
      const listBox = list.getBoundingClientRect();
      known.head = listBox.top - block.getBoundingClientRect().top;
      known.row = listBox.height / count;
    }
    if (known.row <= 0) return;
    const padBottom = Number.parseFloat(getComputedStyle(body).paddingBottom);
    const room =
      bodyBox.bottom -
      (Number.isFinite(padBottom) ? padBottom : 0) -
      block.getBoundingClientRect().top -
      known.head;
    // The line counting the rows left out is about half a row tall.
    const noteRoom = known.row * NOTE_ROWS;
    const all = room >= count * known.row;
    const next = all
      ? null
      : room < known.row
        ? 0
        : Math.max(1, Math.floor((room - noteRoom) / known.row));
    setFitted((was) => (was === next ? was : next));
    const noteFitsNow =
      all || (next !== null && room - next * known.row >= noteRoom);
    setNoteFits((was) => (was === noteFitsNow ? was : noteFitsNow));
  }, [count, fitted]);

  const bodyObserver = useRef<ResizeObserver | null>(null);
  const blockRef = useCallback(
    (el: HTMLDivElement | null) => {
      blockEl.current = el;
      bodyObserver.current?.disconnect();
      bodyObserver.current = null;
      const body = el?.closest<HTMLElement>("[data-panel-body]");
      if (!body || typeof ResizeObserver === "undefined") return;
      bodyObserver.current = new ResizeObserver(() => measure());
      bodyObserver.current.observe(body);
    },
    [measure],
  );
  const listRef = useCallback((el: HTMLDivElement | null) => {
    listEl.current = el;
  }, []);
  // Rows arriving or leaving move the block's own height, which the room is read against.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  return { blockRef, listRef, fitted, noteFits };
}
