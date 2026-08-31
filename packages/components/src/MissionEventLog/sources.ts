import type { Severity } from "@ksp-gonogo/ui-kit";

/**
 * The `mission-event-log.sources` contribution slot: a record of what happened
 * that this app did not observe for itself.
 *
 * The widget derives its own rows from the live stream, one edge at a time, and
 * therefore knows only what happened while it was watching. A career-management
 * mod keeps a written history that predates the dashboard being open, and the
 * only way that history reaches the log is for its Uplink to hand it over.
 *
 * <para><b>The contributed thing is a SOURCE, not an event.</b> An event row
 * cannot say whether the log it came out of is being kept, so a slot of bare
 * rows would deliver an empty array for a source that is recording and has
 * nothing yet, for a source a save has switched off, and for a source whose
 * channel has not spoken, with nothing to tell the three apart. Nesting the rows
 * inside their source makes contributing events without declaring where they
 * came from unrepresentable, rather than merely discouraged.</para>
 *
 * <para>Mirrored as `MissionLogSourceEntry` in `mod/sitrep-sdk`'s
 * `api/contribution-slots.ts`, which is the copy an Uplink types against, the
 * same way `StrategiesScreenEntry` is mirrored for `strategies.screens`.</para>
 */
export interface MissionLogSourceEntry {
  /** Stable id, unique within the contributing client. */
  id: string;
  /** What the operator reads, e.g. "RP-1 career log". */
  label: string;
  /**
   * What this source can currently see. REQUIRED, and the reason the slot is
   * worth having.
   *
   * <para>A contributor that could omit this would be able to hand back an empty
   * list of events meaning any of three unrelated things. Making the word
   * mandatory means a source cannot say "nothing happened" without also saying
   * it was in a position to notice.</para>
   *
   * <para>Three words rather than an `enabled` boolean, because the thing being
   * described has three states and a boolean folds two of them together. RP-1's
   * own `CareerLog` carries a nullable `IsEnabled` and its contract says so in as
   * many words: off is not empty, and unread is neither.</para>
   */
  state: MissionLogSourceState;
  /** Why, in the operator's terms, for a source that is not recording or cannot be read. */
  stateReason?: string;
  /** Everything this source has recorded. Oldest-first is not required; the host sorts. */
  events?: readonly MissionLogEventEntry[];
}

/**
 * - `recording`: the source is keeping its log. An empty `events` means the
 *   history really is empty so far.
 * - `not-recording`: the log is switched off. There is no history to show and
 *   there will not be one until it is switched back on.
 * - `unreadable`: the source exists but has told us nothing, so whether anything
 *   has happened is unknown.
 */
export type MissionLogSourceState =
  | "recording"
  | "not-recording"
  | "unreadable";

/** One row a source contributes to the timeline. */
export interface MissionLogEventEntry {
  /** Stable id, unique within its source. */
  id: string;
  /** When it happened. An INSTANT, so a UT, in seconds. */
  ut: number;
  /** What happened, in the source's own words. */
  label: string;
  /** Secondary detail, shown after the label. */
  detail?: string;
  /**
   * Short chip text, e.g. "FAILURE". Upper-cased by the host. A row without one
   * falls back to "LOG", since a row with no chip at all reads as a different
   * kind of thing from the rows around it.
   */
  kindLabel?: string;
  /**
   * How alarming the row is. The host owns the palette, so a contributor names
   * a severity and never a colour. The established three words every other
   * contribution in the app uses.
   */
  severity?: "info" | "warning" | "critical";
  /**
   * The occurrence several rows belong to: a flight, a construction, a
   * campaign. Rows sharing one are marked so an operator can see that a failure
   * and the launch it happened on were the same flight, which is the question a
   * career log gets opened to answer.
   */
  groupId?: string;
}

declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "mission-event-log.sources": {
      entry: MissionLogSourceEntry;
    };
  }
}

/** One source after resolution: what the widget says about it, if anything. */
export interface ResolvedLogSource {
  id: string;
  label: string;
  state: MissionLogSourceState;
  /**
   * The sentence the widget shows about this source, or null when the rows
   * speak for themselves. Never a bare "no events": a source that cannot see
   * its log and a source watching a quiet career get different sentences here,
   * and that difference is the whole point of the slot.
   */
  note: string | null;
  /** How many rows this source handed over. */
  eventCount: number;
}

/** One row of the rendered log, whether the widget derived it or a source handed it over. */
export interface MissionLogRow {
  /** React key, unique across sources and the widget's own events. */
  key: string;
  ut: number;
  label: string;
  detail?: string;
  /** The chip's text. */
  badgeLabel: string;
  /** The chip's severity; undefined renders the grey no-severity chip. */
  severity: Severity | undefined;
  /**
   * The shared-occurrence marker, present only when another row on screen
   * carries the same `groupId`. A lone row's group id joins to nothing, so
   * showing it would be noise shaped like information.
   */
  groupTag?: string;
}

const CONTRIBUTED_SEVERITY: Record<
  NonNullable<MissionLogEventEntry["severity"]>,
  Severity
> = {
  info: "info",
  warning: "warning",
  critical: "critical",
};

/**
 * Resolve the contributed sources: dedupe by id, and decide what each one has
 * earned a sentence about.
 *
 * First registration per id wins, the same convention `resolveScreens` and
 * ShipMap's `groupByPart` already use.
 */
export function resolveLogSources(
  entries: readonly MissionLogSourceEntry[],
): ResolvedLogSource[] {
  const byId = new Map<string, ResolvedLogSource>();
  for (const entry of entries) {
    if (byId.has(entry.id)) continue;
    const eventCount = entry.events?.length ?? 0;
    byId.set(entry.id, {
      id: entry.id,
      label: entry.label,
      state: entry.state,
      note: noteFor(entry, eventCount),
      eventCount,
    });
  }
  return [...byId.values()];
}

function noteFor(
  entry: MissionLogSourceEntry,
  eventCount: number,
): string | null {
  const reason = entry.stateReason ? ` (${entry.stateReason})` : "";
  if (entry.state === "not-recording") {
    return `${entry.label}: not recording${reason}`;
  }
  if (entry.state === "unreadable") {
    return `${entry.label}: no data received${reason}`;
  }
  // Recording. The rows are the statement when there are rows; when there are
  // none, saying so is what stops a quiet career reading as a broken one.
  return eventCount === 0 ? `${entry.label}: recording, nothing yet` : null;
}

/**
 * Merge the widget's own rows with every contributed source's rows into one
 * timeline, oldest first.
 *
 * The widget owns the order, so a source hands rows over in whatever order it
 * has them. Ties break on the key so the sequence is stable across renders
 * rather than depending on the order contributions happened to register in.
 */
export function mergeLogRows(
  own: readonly MissionLogRow[],
  entries: readonly MissionLogSourceEntry[],
): MissionLogRow[] {
  const rows: MissionLogRow[] = [...own];
  const groupCounts = new Map<string, number>();
  const seenSources = new Set<string>();

  for (const source of entries) {
    if (seenSources.has(source.id)) continue;
    seenSources.add(source.id);
    for (const event of source.events ?? []) {
      if (event.groupId) {
        groupCounts.set(
          event.groupId,
          (groupCounts.get(event.groupId) ?? 0) + 1,
        );
      }
      rows.push({
        key: `${source.id}:${event.id}`,
        ut: event.ut,
        label: event.label,
        detail: event.detail,
        badgeLabel: (event.kindLabel ?? "log").toUpperCase(),
        severity: event.severity
          ? CONTRIBUTED_SEVERITY[event.severity]
          : undefined,
        groupTag: event.groupId,
      });
    }
  }

  // A group id only one row carries joins to nothing, so it is dropped rather
  // than shown. Done after the walk because whether a row's group is shared
  // cannot be known until every source has been read.
  for (const row of rows) {
    if (row.groupTag && (groupCounts.get(row.groupTag) ?? 0) < 2) {
      row.groupTag = undefined;
    }
  }

  return rows.sort((a, b) =>
    a.ut === b.ut ? a.key.localeCompare(b.key) : a.ut - b.ut,
  );
}
