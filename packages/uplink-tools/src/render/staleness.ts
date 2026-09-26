import { UNANNOUNCED_MARK } from "./probe-global";

/**
 * Whether a subject says the link has gone, judged from two renders of one
 * scene: live, and with the link dropped.
 *
 * <p>Every render the harness takes of a stream-fed scene gets a twin with the
 * other `stopsArriving` value, so an Uplink needs no stale fixture for its
 * widgets to be held to this. A scene that already stages the drop is compared
 * with itself fed live; one that does not is compared with itself dropped.</p>
 *
 * <p>Two ways to fail. UNCHANGED: the subject draws exactly the same elements
 * both ways, so an operator has nothing to tell a figure from twenty minutes ago
 * from one that just arrived. UNANNOUNCED: the subject draws a held mark with
 * no caption, so the dot is there and a screen reader is told nothing.</p>
 *
 * <p>A guest drawn inside a real host is judged on what IT draws. The host may
 * mark its own readings, and a render that changed only because the host did is
 * the case this exists for: a correctly marked panel carrying a figure nobody
 * marked. So a hosted scene is also rendered with its guest withheld, in both
 * states, and the guest's elements are what is left after the host's are taken
 * away.</p>
 */
export interface StalenessRenders {
  live: readonly string[];
  stale: readonly string[];
  /** The same two renders with the guest withheld, for a hosted scene. */
  hostOnly?: { live: readonly string[]; stale: readonly string[] };
}

export interface StalenessVerdict {
  /** The subject drew the same elements live and with the link dropped. */
  unchanged: boolean;
  /** How many of the subject's elements differ between the two, counted both ways. */
  changed: number;
  /** The differing elements, `-` drawn only live and `+` only with the link dropped. */
  differences: string[];
  /** How many elements the subject drew live, and with the link dropped, bare wrappers not counted. */
  drawn: { live: number; stale: number };
  /** Elements the subject drew held with no caption saying so. */
  unannounced: string[];
}

/** What `from` has that `take` does not, counting repeats. */
export function multisetMinus(
  from: readonly string[],
  take: readonly string[],
): string[] {
  const left = new Map<string, number>();
  for (const line of take) left.set(line, (left.get(line) ?? 0) + 1);
  const out: string[] = [];
  for (const line of from) {
    const n = left.get(line) ?? 0;
    if (n > 0) left.set(line, n - 1);
    else out.push(line);
  }
  return out;
}

/**
 * An element with no text of its own and nothing but a class: a layout wrapper.
 * See {@link judgeStaleness} for when one is not counted.
 */
function isBareWrapper(line: string): boolean {
  return /^<[a-z0-9-]+ (class="[^"]*")?> $/.test(line);
}

function tagOf(line: string): string {
  return line.slice(1, line.indexOf(" "));
}

/**
 * Drop a bare wrapper that appears on one side only with no bare wrapper of its
 * tag on the other. A layout box a host adds or removes around its guest says
 * nothing to an operator; the same box restyled (a dimmed class in place of a
 * lit one) appears on both sides and is kept.
 */
function withoutLoneWrappers(
  gone: readonly string[],
  added: readonly string[],
): { gone: string[]; added: string[] } {
  const bareTags = (lines: readonly string[]) =>
    new Set(lines.filter(isBareWrapper).map(tagOf));
  const goneTags = bareTags(gone);
  const addedTags = bareTags(added);
  return {
    gone: gone.filter((l) => !isBareWrapper(l) || addedTags.has(tagOf(l))),
    added: added.filter((l) => !isBareWrapper(l) || goneTags.has(tagOf(l))),
  };
}

export function judgeStaleness(renders: StalenessRenders): StalenessVerdict {
  const subjectLive = renders.hostOnly
    ? multisetMinus(renders.live, renders.hostOnly.live)
    : renders.live;
  const subjectStale = renders.hostOnly
    ? multisetMinus(renders.stale, renders.hostOnly.stale)
    : renders.stale;
  const { gone, added } = withoutLoneWrappers(
    multisetMinus(subjectLive, subjectStale),
    multisetMinus(subjectStale, subjectLive),
  );
  const differences = [
    ...gone.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
  ];
  const changed = differences.length;
  const unchanged = changed === 0;
  return {
    unchanged,
    changed,
    differences,
    drawn: {
      live: subjectLive.filter((l) => !isBareWrapper(l)).length,
      stale: subjectStale.filter((l) => !isBareWrapper(l)).length,
    },
    unannounced: subjectStale.filter((line) => line.endsWith(UNANNOUNCED_MARK)),
  };
}
