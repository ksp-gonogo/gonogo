/**
 * One line of a facility tier's stock description.
 *
 * `pair` is the shape the game almost always emits, "Max Size: 140t": a named
 * property and its setting. `note` is everything else, including a line that
 * states a capability outright ("Maneuver nodes enabled") and any line whose
 * form we did not anticipate.
 *
 * `id` identifies the line within its own tier. The content is what makes a
 * line the line it is, so it is the identity; a repeated line gets a suffix so
 * two of them stay distinguishable.
 */
export type TierSpec = { id: string } & (
  | { kind: "pair"; label: string; value: string }
  | { kind: "note"; text: string }
);

/**
 * KSP's own upgrade dialog writes its tier descriptions as an asterisk-bulleted
 * list in one string, so `"* Max Size: 140t\n* Max Parts: 255"` is what arrives
 * on the wire. The asterisks are the game's list markup and mean nothing to an
 * operator reading a dashboard; this turns them into items the widget can lay
 * out as a real list.
 *
 * The marker set is narrow on purpose. Stripping anything that could plausibly
 * start a line risks eating a minus sign off a negative value, and a stray
 * marker in front of a line the operator can still read costs far less than a
 * mangled number.
 *
 * The text is game copy rather than a contract, so a line that fits no pattern
 * is kept as a `note` and shown as it arrived. Dropping it would hide whatever
 * a future KSP version, a localisation or a mod decided to say there.
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
