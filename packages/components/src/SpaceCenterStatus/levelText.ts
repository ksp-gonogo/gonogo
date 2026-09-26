/**
 * One line of a facility tier's stock description: a `pair` ("Max Size: 140t")
 * or a `note` (anything else). `id` is the content, suffixed when repeated.
 */
export type TierSpec = { id: string } & (
  | { kind: "pair"; label: string; value: string }
  | { kind: "note"; text: string }
);

/**
 * Splits KSP's asterisk-bulleted tier text into items. The marker set is narrow
 * so a minus sign on a negative value is never eaten, and a line that fits no
 * pattern is kept as a `note` rather than dropped.
 */
export function parseLevelText(text: string): TierSpec[] {
  const specs: TierSpec[] = [];
  const seen = new Map<string, number>();
  for (const rawLine of text.split(/\r?\n/)) {
    const content = rawLine
      .trim()
      .replace(/^[*•]\s*/, "")
      .trim();
    if (content === "") continue;
    const repeats = seen.get(content) ?? 0;
    seen.set(content, repeats + 1);
    const id = repeats === 0 ? content : `${content}#${repeats}`;

    const colon = content.indexOf(":");
    const label = colon === -1 ? "" : content.slice(0, colon).trim();
    const value = colon === -1 ? "" : content.slice(colon + 1).trim();
    if (label !== "" && value !== "") {
      specs.push({ id, kind: "pair", label, value });
    } else {
      specs.push({ id, kind: "note", text: content });
    }
  }
  return specs;
}
