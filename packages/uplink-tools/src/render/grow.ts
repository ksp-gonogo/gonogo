/**
 * Grow `#root` until nothing it can reveal is clipped, and no further.
 *
 * Passed to `tab.evaluate`, so it closes over nothing and declares no named
 * function inside: tsx's `keepNames` wraps one in a `__name(...)` helper that
 * exists in the module scope and not the serialised page context.
 *
 * Every clipping box under the root is measured, found rather than listed: a
 * `Panel`'s body is the scroller in this kit and carries no marker, so a
 * hand-kept list of the ways content hides goes stale silently. The root grows
 * by the largest overflow and the tree is measured again, because growing can
 * reveal a little more.
 *
 * Only an overflow the root's height governs is worth growing for. A box of a
 * fixed height clips the same amount at any root height: a screen-reader-only
 * label clipped to 1px, or a list with its own `max-height`. After each growth
 * a box whose overflow did not shrink is set aside for good, and a growth made
 * on behalf of such a box is undone, so the root grows no taller than the
 * content it reveals.
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
