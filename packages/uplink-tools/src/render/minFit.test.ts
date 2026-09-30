// @vitest-environment jsdom
/*
 * `auditMinFit` needs real layout for almost everything it checks (scrollWidth,
 * getBoundingClientRect), which jsdom never computes, so the audit as a whole is
 * proven by the Playwright render harness, not here. `painted()`'s clip-rect-0
 * guard is the one part of it that is pure CSSOM, no geometry involved, so it is
 * covered directly: the sr-only tiny-tile title must stop reading as
 * `title-clipped`, and every case `painted()` already covered must keep doing
 * so.
 */
import { afterEach, describe, expect, it } from "vitest";
import { auditMinFit } from "./minFit";

/** Fakes a title whose text is wider than its box, since jsdom's own scrollWidth and clientWidth are always zero. */
function stubOverflow(el: HTMLElement, over: number): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 40 });
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    value: 40 + over,
  });
}

function tileWith(titleHtml: string): HTMLElement {
  document.body.innerHTML = `<div id="tile">${titleHtml}</div>`;
  return document.getElementById("tile") as HTMLElement;
}

function isTitleClipped(tile: HTMLElement): boolean {
  return auditMinFit(tile).some((f) => f.kind === "title-clipped");
}

describe("auditMinFit: painted() and the sr-only tiny-tile title", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports an ordinary overflowing title as clipped", () => {
    const tile = tileWith("<h3>A very long widget title that overflows</h3>");
    stubOverflow(tile.querySelector("h3") as HTMLElement, 20);
    expect(isTitleClipped(tile)).toBe(true);
  });

  it("does not report the tiny tile's hover-revealed title, sr-only at rest", () => {
    const tile = tileWith(
      '<h3 style="position:absolute;width:1px;height:1px;overflow:hidden;' +
        'clip:rect(0,0,0,0);white-space:nowrap;">A very long widget title ' +
        "that overflows</h3>",
    );
    stubOverflow(tile.querySelector("h3") as HTMLElement, 20);
    expect(isTitleClipped(tile)).toBe(false);
  });

  it("still ignores a visibility:hidden title, the collapsed-aside case the check already covered", () => {
    const tile = tileWith(
      '<h3 style="visibility:hidden;">A very long widget title that overflows</h3>',
    );
    stubOverflow(tile.querySelector("h3") as HTMLElement, 20);
    expect(isTitleClipped(tile)).toBe(false);
  });

  it("keeps reporting a title under an ancestor clipped to something other than the sr-only zero rect", () => {
    const tile = tileWith(
      '<div style="position:absolute;clip:rect(0px,40px,20px,0px);">' +
        "<h3>A very long widget title that overflows</h3></div>",
    );
    stubOverflow(tile.querySelector("h3") as HTMLElement, 20);
    expect(isTitleClipped(tile)).toBe(true);
  });
});
