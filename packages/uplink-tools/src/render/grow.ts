/**
 * Grows `#root` until nothing it can reveal is clipped, and no further. Useful
 * for taking a picture of a widget that shows all of its content instead of a
 * scrolled part of it. Used by the render driver before it takes a screenshot.
 *
 * Every clipping box under the root is measured, and the root grows by the
 * largest overflow, then the tree is measured again because growing can reveal
 * more. A box of a fixed height clips the same amount at any root height, such
 * as a screen-reader-only label or a list with its own `max-height`; after a
 * growth in which its overflow did not shrink it is set aside, and the growth
 * made for it is undone.
 *
 * It is passed to `tab.evaluate`, so it closes over nothing and declares no
 * named function inside: tsx's `keepNames` wraps one in a `__name(...)` helper
 * that does not exist in the serialised page context.
 */
export const growRootToContent = (): void => {
  const el = document.getElementById("root");
  if (!el) return;
  el.style.overflow = "visible";
  const fixed = new Set<Element>();
  let measured = new Map<Element, number>();
  let driver: Element | undefined;
  let heightBefore = el.style.height;
  let grew = false;
  for (let i = 0; i < 16; i++) {
    const overflows = new Map<Element, number>();
    const boxes: Element[] = [el, ...el.querySelectorAll("*")];
    for (const node of boxes) {
      const over = node.scrollHeight - node.clientHeight;
      if (over <= 1) continue;
      if (node !== el && getComputedStyle(node).overflowY === "visible") {
        continue;
      }
      overflows.set(node, over);
    }
    if (grew) {
      for (const [node, over] of measured) {
        if ((overflows.get(node) ?? 0) >= over) fixed.add(node);
      }
      grew = false;
      if (driver && fixed.has(driver)) {
        el.style.height = heightBefore;
        void el.offsetHeight;
        continue;
      }
    }
    let need = 0;
    driver = undefined;
    for (const [node, over] of overflows) {
      if (fixed.has(node) || over <= need) continue;
      need = over;
      driver = node;
    }
    if (!driver) break;
    measured = overflows;
    heightBefore = el.style.height;
    el.style.height = `${el.clientHeight + need}px`;
    void el.offsetHeight;
    grew = true;
  }
};
