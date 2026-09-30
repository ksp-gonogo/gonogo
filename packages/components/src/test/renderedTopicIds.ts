import { getAllKnownTopicIds } from "@ksp-gonogo/sitrep-sdk";

/** The attributes an operator reads on hover or hears from a screen reader. */
const READ_ATTRIBUTES = [
  "title",
  "aria-label",
  "aria-description",
  "alt",
  "placeholder",
] as const;

function escaped(id: string): string {
  return id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every known Topic id, and any dynamic sub-topic under one, as a whole token.
 * Longest first, so `vessel.orbit.truth` is reported whole rather than as its
 * `vessel.orbit` prefix.
 */
function topicPattern(): RegExp {
  const ids = [...getAllKnownTopicIds()]
    .sort((a, b) => b.length - a.length)
    .map(escaped);
  return new RegExp(
    `(?<![\\w.-])(?:${ids.join("|")})(?:\\.[\\w-]+)*(?![\\w-])`,
    "g",
  );
}

/**
 * The Topic ids a render shows an operator, in its text or in an attribute
 * they read on hover or through assistive technology. A Topic id is wire
 * vocabulary: a widget that prints one has let the plumbing reach the screen.
 */
export function renderedTopicIds(container: HTMLElement): string[] {
  const pattern = topicPattern();
  const said: string[] = [];
  // Node by node, since adjacent elements' text runs together in `textContent`.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent) said.push(node.textContent);
  }
  for (const element of container.querySelectorAll("*")) {
    for (const name of READ_ATTRIBUTES) {
      const text = element.getAttribute(name);
      if (text) said.push(text);
    }
  }
  return [...new Set(said.flatMap((text) => text.match(pattern) ?? []))];
}
