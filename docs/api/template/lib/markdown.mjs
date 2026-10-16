/**
 * Markdown for the document's descriptions. A code span that names a schema
 * (`ScetAlarm`, `ScetAlarm.id`) or a channel (`alarm.scet.arm`) becomes a link
 * to its section, so the cross-references the contract's comments already make
 * can be followed on the page.
 */

import { Marked } from "marked";
import { escapeHtml, schemaAnchor } from "./schema.mjs";

export function channelAnchor(address) {
  return `channel-${address}`;
}

export function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * @param {{
 *   schemaNames: Set<string>,
 *   channelAddresses: Set<string>,
 *   schemaHref?: (name: string) => string,
 *   schemaDisplay?: (name: string) => string,
 * }} names
 *   `schemaDisplay` is the name a reader meets on the wire, such as
 *   `set-vantage` for the `SetVantage` frame
 */
export function createMarkdown({
  schemaNames,
  channelAddresses,
  schemaHref = (name) => `#${schemaAnchor(name)}`,
  schemaDisplay = (name) => name,
  enumMember = () => null,
  frameTypes = new Set(),
  frameHref = (type) => `#frame-${type}`,
}) {
  function codespan({ text }) {
    const decoded = text
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
    if (channelAddresses.has(decoded))
      return `<a class="code-ref" href="#${escapeHtml(channelAnchor(decoded))}"><code>${escapeHtml(decoded)}</code></a>`;
    if (frameTypes.has(decoded))
      return `<a class="code-ref" href="${escapeHtml(frameHref(decoded))}"><code>${escapeHtml(decoded)}</code></a>`;
    const [head, ...rest] = decoded.split(".");
    const member =
      rest.length === 1 && schemaNames.has(head)
        ? enumMember(head, rest[0])
        : null;
    if (member)
      return `<a class="code-ref" href="${escapeHtml(schemaHref(head))}"><code>${escapeHtml(member)}</code></a>`;
    if (schemaNames.has(head)) {
      const display = [schemaDisplay(head), ...rest].join(".");
      return `<a class="code-ref" href="${escapeHtml(schemaHref(head))}"><code>${escapeHtml(display)}</code></a>`;
    }
    return `<code>${escapeHtml(decoded)}</code>`;
  }

  /**
   * @param {string} source
   * @param {{ headingOffset?: number, headingIds?: string }} [options]
   *   `headingOffset` moves every heading down that many levels so a
   *   description sits under the page's own heading; `headingIds` prefixes the
   *   id each heading is given
   */
  function block(source, { headingOffset = 2, headingIds } = {}) {
    const marked = new Marked({
      gfm: true,
      renderer: {
        codespan,
        heading({ tokens, depth, text }) {
          const level = Math.min(depth + headingOffset, 6);
          const id = headingIds ? ` id="${headingIds}-${slug(text)}"` : "";
          return `<h${level}${id}>${this.parser.parseInline(tokens)}</h${level}>\n`;
        },
      },
    });
    return marked.parse(source ?? "");
  }

  function inline(source) {
    const marked = new Marked({ gfm: true, renderer: { codespan } });
    return marked.parseInline(source ?? "");
  }

  /** The headings of a description, for the sidebar. */
  function headings(source) {
    const marked = new Marked({ gfm: true });
    return marked
      .lexer(source ?? "")
      .filter((token) => token.type === "heading" && token.depth === 2)
      .map((token) => ({
        text: token.text.replaceAll("`", ""),
        id: slug(token.text),
      }));
  }

  return { block, inline, headings };
}
