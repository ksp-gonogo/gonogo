/** One figure a primitive stamped, as the sweep reads it. */
export interface Figure {
  text: string;
  isStatic: boolean;
  held: boolean;
}

/**
 * Every figure in `container`, innermost only: an instrument that stamps its
 * root and draws its readout through `<Unit>` would otherwise count once for
 * each.
 */
export function figuresIn(container: Element): Figure[] {
  return [...container.querySelectorAll("[data-figure]")]
    .filter((el) => el.querySelector("[data-figure]") === null)
    .map((el) => ({
      text: (el.textContent ?? "").trim(),
      isStatic: el.getAttribute("data-figure") === "static",
      held: el.closest("[data-held]") !== null,
    }));
}

/**
 * The stale figures drawn identical to a live one and marked as neither held
 * nor static. Matched as a multiset of texts, so a figure that moved position
 * between the two renders is still paired with its twin.
 */
export function unmarkedStaleFigures(
  live: readonly Figure[],
  stale: readonly Figure[],
): string[] {
  const liveTexts = new Map<string, number>();
  for (const f of live) liveTexts.set(f.text, (liveTexts.get(f.text) ?? 0) + 1);
  const unmarked: string[] = [];
  for (const f of stale) {
    if (f.held || f.isStatic) continue;
    const left = liveTexts.get(f.text) ?? 0;
    if (left === 0) continue;
    liveTexts.set(f.text, left - 1);
    unmarked.push(f.text);
  }
  return unmarked;
}
