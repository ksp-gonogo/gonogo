import { getComponents } from "../api/registry";

/**
 * Every augment and contribution slot id the sdk declares, in full. Useful for
 * telling a slot an Uplink can bind from a name that nothing draws. Used by the
 * development warning when an augment or a contribution names a slot, and by
 * `uplink-tools check`.
 *
 * A slot a widget of an Uplink declares for itself is not listed here; it is
 * known once that widget is registered.
 */
export const KNOWN_SLOT_IDS = [
  "action-group.subsystem",
  "administration-building.screen-body",
  "administration-building.screens",
  "app.header-badges",
  "astronaut-complex.crew",
  "astronaut-complex.crew-badge",
  "astronaut-complex.readouts",
  "astronaut-complex.tab",
  "comm-signal.hop-rates",
  "comm-signal.sections",
  "crew-status.avatar",
  "crew-status.meters",
  "crew-status.row-badges",
  "crew-status.row-tone",
  "crew-status.summary",
  "deployed-science.experiment",
  "experiments.actions",
  "experiments.instrument",
  "experiments.instruments",
  "fuel-status.sections",
  "ground-track.actions",
  "ground-track.base",
  "ground-track.overlay",
  "ground-track.sections",
  "landing-status.actions",
  "landing-status.sections",
  "launch-director.pad",
  "launch-director.preflight",
  "maneuver-planner.sections",
  "objectives.source",
  "orbit-view.overlay",
  "plots",
  "power-systems.sections",
  "rendezvous.camera",
  "rendezvous.overlay",
  "research-and-development.sections",
  "science-data.aboard-row",
  "ship-map.overlay",
  "ship-map.part-meta",
  "ship-map.part-meters",
  "space-center-status.facilities",
  "space-center-status.sections",
  "target-picker.sections",
  "tracking-station.actions",
  "tracking-station.entities",
  "tracking-station.overlay",
  "tracking-station.projection",
  "tracking-station.vessel-status",
  "vessel-catalog.updates",
  "warp-control.stepper",
] as const;

/** The trailing names every widget's panel and header complete to `<widget id>.<segment>`. */
const STANDARD_SEGMENTS = [
  "sections",
  "actions",
  "badges",
  "filters",
  "meters",
] as const;

/** Edit distance between two short strings. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length];
}

/**
 * The slot ids that are close to `slot`: a small edit distance, or the same
 * trailing segment under another widget (`system-view.entities` against
 * `tracking-station.entities`), nearest first and at most three.
 * Useful for telling an Uplink author which slot they probably meant.
 */
export function closestSlotIds(
  slot: string,
  known: readonly string[],
): string[] {
  const tail = (id: string) => id.slice(id.lastIndexOf(".") + 1);
  return known
    .map((id) => {
      const distance = editDistance(slot, id);
      const sameTail = tail(id) === tail(slot) && id.includes(".");
      return { id, rank: sameTail ? Math.min(distance, 4) : distance };
    })
    .filter((c) => c.rank <= 4)
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((c) => c.id);
}

/**
 * Whether `slot` is one an augment or a contribution can be drawn in: a slot
 * the sdk declares, a slot a registered widget declares, or a standard segment
 * of a registered widget.
 */
export function isKnownSlotId(slot: string): boolean {
  if ((KNOWN_SLOT_IDS as readonly string[]).includes(slot)) return true;
  const dot = slot.lastIndexOf(".");
  const segment = slot.slice(dot + 1);
  for (const def of getComponents()) {
    if (
      def.augmentSlots?.includes(slot as never) ||
      def.contributionSlots?.includes(slot as never)
    ) {
      return true;
    }
    if (
      dot > 0 &&
      slot.slice(0, dot) === def.id &&
      (STANDARD_SEGMENTS as readonly string[]).includes(segment)
    ) {
      return true;
    }
  }
  return false;
}

/** Every slot id known now, for naming the close ones in a warning. */
function knownSlotIdsNow(): string[] {
  const out = new Set<string>(KNOWN_SLOT_IDS);
  for (const def of getComponents()) {
    for (const s of def.augmentSlots ?? []) out.add(s);
    for (const s of def.contributionSlots ?? []) out.add(s);
  }
  return [...out];
}

const warned = new Set<string>();

/**
 * Warns, in development, that `kind` `id` names a slot nothing draws. The
 * check runs once the registering module has finished loading, so a widget
 * registered in the same bundle has declared its slots by then. The warning
 * names the id, the Uplink and the slots close to the one given.
 */
export function warnIfSlotUnknown(
  kind: "contribution" | "augment",
  def: { id: string; owner?: { id: string; name: string } },
  slot: string,
  warn: (message: string) => void,
): void {
  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "production"
  ) {
    return;
  }
  queueMicrotask(() => {
    if (isKnownSlotId(slot)) return;
    const key = `${kind}:${def.id}:${slot}`;
    if (warned.has(key)) return;
    warned.add(key);
    const owner = def.owner ? `${def.owner.name} (${def.owner.id})` : "unknown";
    const close = closestSlotIds(slot, knownSlotIdsNow());
    const hint =
      close.length > 0
        ? ` Close slots: ${close.map((c) => `"${c}"`).join(", ")}.`
        : "";
    warn(
      `The ${kind} "${def.id}" names slot "${slot}", which no widget draws, so it will render nothing. ` +
        `Registered by Uplink: ${owner}.${hint}`,
    );
  });
}

/** Forgets which slots have been warned about. For tests only. */
export function resetSlotWarnings(): void {
  warned.clear();
}
