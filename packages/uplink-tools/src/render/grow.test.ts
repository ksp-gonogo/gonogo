// @vitest-environment jsdom
//
// jsdom lays nothing out, so each box's geometry is a function of the root's
// height, written here. That is the one input the grow step acts on, and it is
// what tells a box the root governs from a box that clips the same at any size.
import { afterEach, describe, expect, it } from "vitest";
import { growRootToContent } from "./grow";

afterEach(() => {
  document.body.innerHTML = "";
});

function mountRoot(height: number): HTMLElement {
  const root = document.createElement("div");
  root.id = "root";
  root.style.height = `${height}px`;
  Object.defineProperty(root, "clientHeight", { get: rootHeight });
  document.body.append(root);
  return root;
}

function rootHeight(): number {
  return Number.parseFloat(document.getElementById("root")?.style.height ?? "");
}

/** A box whose client and scroll heights follow the root's height. */
function box(
  parent: HTMLElement,
  overflowY: string,
  geometry: (root: number) => { client: number; scroll: number },
): HTMLElement {
  const el = document.createElement("div");
  el.style.overflowY = overflowY;
  Object.defineProperty(el, "clientHeight", {
    get: () => geometry(rootHeight()).client,
  });
  Object.defineProperty(el, "scrollHeight", {
    get: () => geometry(rootHeight()).scroll,
  });
  parent.append(el);
  return el;
}

/** A panel whose scrolling body is the root less a 40px header. */
function panelBody(root: HTMLElement, content: (h: number) => number): void {
  box(root, "auto", (h) => ({ client: h - 40, scroll: content(h - 40) }));
}

describe("growRootToContent", () => {
  it("grows the root until the panel body shows all of its content", () => {
    const root = mountRoot(200);
    panelBody(root, () => 400);

    growRootToContent();

    expect(rootHeight()).toBe(440);
  });

  it("does not grow for a screen-reader-only label, whose clip no root height changes", () => {
    const root = mountRoot(200);
    panelBody(root, () => 400);
    box(root, "hidden", () => ({ client: 1, scroll: 13 }));

    growRootToContent();

    expect(rootHeight()).toBe(440);
  });

  it("leaves the tile as it is when the only overflow sits in a box of its own fixed height", () => {
    const root = mountRoot(200);
    panelBody(root, () => 100);
    box(root, "auto", () => ({ client: 120, scroll: 300 }));

    growRootToContent();

    expect(rootHeight()).toBe(200);
  });

  it("keeps growing when growing reveals more content", () => {
    const root = mountRoot(200);
    panelBody(root, (body) => (body < 400 ? 400 : 520));

    growRootToContent();

    expect(rootHeight()).toBe(560);
  });

  it("counts an overflow the root's height governs even beside a larger fixed one", () => {
    const root = mountRoot(200);
    panelBody(root, () => 260);
    box(root, "hidden", () => ({ client: 1, scroll: 300 }));

    growRootToContent();

    expect(rootHeight()).toBe(300);
  });
});
