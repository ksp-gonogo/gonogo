/**
 * The CSS styled-components actually emitted for `element`'s own generated
 * class, as text.
 *
 * jsdom cannot resolve a declaration whose value is a `var()`, and does not lay
 * an absolutely-positioned box out at all, so `getComputedStyle(el).border`,
 * `.top` and `.paddingTop` all answer with the initial value whatever the
 * stylesheet says. Every assertion in this package about WHICH EDGE something
 * is pinned to, or which token an inset reads, has to go through the emitted
 * rule instead.
 *
 * Throws rather than returning empty when no rule matches: a lookup that
 * silently finds nothing turns "the chip is on the top border" into "no rule
 * was examined", and both read green.
 */
export function emittedRuleFor(element: HTMLElement): string {
  const generated = Array.from(element.classList).filter(
    (name) => !name.startsWith("sc-"),
  );
  const sheet = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("");
  for (const name of generated) {
    const at = sheet.indexOf(`.${name}{`);
    if (at !== -1) {
      return sheet.slice(at, sheet.indexOf("}", at) + 1);
    }
  }
  throw new Error(
    `no emitted rule for any of [${generated.join(", ")}]; the stylesheet lookup is broken, not the style`,
  );
}
