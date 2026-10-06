interface NamedCentre {
  id: string;
  displayName?: string | null;
}

/**
 * What to call each command centre in the vantage picker, by id.
 *
 * A centre goes by its name. Crewed craft launched from one design share a
 * name, and a picker listing "Sally-Hut 1" three times leaves no way to choose
 * between them, so centres of one name each take the start of their own id in
 * brackets: enough of it to differ, and never fewer than four characters. The
 * id is the craft's own and does not change, so the same craft is the same
 * entry on every screen and after every load.
 */
export function vantageLabels(
  centres: readonly NamedCentre[],
): Map<string, string> {
  const sharing = new Map<string, NamedCentre[]>();
  for (const centre of centres) {
    const name = centre.displayName ?? centre.id;
    sharing.set(name, [...(sharing.get(name) ?? []), centre]);
  }
  const labels = new Map<string, string>();
  for (const [name, named] of sharing) {
    if (named.length === 1) {
      labels.set(named[0].id, name);
      continue;
    }
    const length = distinguishingLength(named.map((c) => ownPart(c.id)));
    for (const centre of named) {
      labels.set(centre.id, `${name} (${ownPart(centre.id).slice(0, length)})`);
    }
  }
  return labels;
}

/** The part of a centre's id that is its own: what follows `vessel:` or `ground:`. */
function ownPart(id: string): string {
  const colon = id.indexOf(":");
  return colon === -1 ? id : id.slice(colon + 1);
}

const SHORTEST = 4;

/** How many leading characters it takes for every one of `ids` to read differently, at least four. */
function distinguishingLength(ids: readonly string[]): number {
  const longest = Math.max(...ids.map((id) => id.length));
  for (let length = SHORTEST; length < longest; length++) {
    if (new Set(ids.map((id) => id.slice(0, length))).size === ids.length) {
      return length;
    }
  }
  return longest;
}
