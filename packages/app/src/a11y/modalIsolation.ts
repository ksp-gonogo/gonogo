/**
 * Hide everything behind a modal from focus and from the accessibility tree.
 *
 * Both consent gates land as direct children of `document.body` (the analytics
 * one portals there, the Uplink one mounts its own root there because it runs
 * pre-render), so a gate's siblings under body are the whole rest of the page.
 * `inert` is the real exclusion: focus, tab order and pointer events all stop
 * at it. The `aria-hidden` alongside is belt-and-braces, some engines' accessible
 * -name computation keys off aria-hidden rather than inert.
 *
 * Refcounted per element because the gates can stack: the Uplink consent prompt
 * can open over the Settings modal, and a plain set-on-open / remove-on-close
 * pair would have the inner gate's close strip isolation off the page that the
 * outer one still needs hidden.
 */
const isolationDepth = new WeakMap<Element, number>();

/**
 * Isolate every `document.body` child except `container`. Returns the release,
 * which is idempotent and only lifts isolation once the last caller has let go.
 */
export function isolateModal(container: Element): () => void {
  const siblings = Array.from(document.body.children).filter(
    (el) => el !== container,
  );

  for (const el of siblings) {
    const depth = (isolationDepth.get(el) ?? 0) + 1;
    isolationDepth.set(el, depth);
    if (depth > 1) continue;
    el.setAttribute("inert", "");
    el.setAttribute("aria-hidden", "true");
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const el of siblings) {
      const depth = (isolationDepth.get(el) ?? 1) - 1;
      if (depth > 0) {
        isolationDepth.set(el, depth);
        continue;
      }
      isolationDepth.delete(el);
      el.removeAttribute("inert");
      el.removeAttribute("aria-hidden");
    }
  };
}
