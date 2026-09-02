import type { StatEntry } from "@ksp-gonogo/sitrep-sdk";
import { useContributionsBySlotId } from "./contributionsRead";
import { NullValue } from "./NullValue";
import { Stat } from "./Stat";
import { Unit } from "./Unit";

export interface StatContributionsProps {
  /**
   * The widget-led slot the host declared, in full
   * (`"astronaut-complex.readouts"`).
   *
   * A full slot id rather than a segment, because a strip of headline figures is
   * not something every widget has. `WidgetMeters` can take the bare `"meters"`
   * segment and have the runtime complete it for whichever widget it is mounted
   * in; a universal `readouts` segment would put a slot aggregator on all sixty
   * widgets to serve the handful that draw a strip, which is the reason `plots`
   * is not a segment either.
   */
  slot: string;
}

/**
 * Every stat contributed to `slot`, drawn through the kit's own {@link Stat}.
 *
 * <para>A FRAGMENT, not a wrapper: the cells have to land in the host's own
 * `StatStrip` as siblings of its vanilla ones, because the whole point is that a
 * contributed figure is indistinguishable from a built-in one. A wrapper would
 * make the contributed set one grid cell, so an Uplink's stats would read as a
 * block bolted onto the end of the row.</para>
 *
 * <para>Renders NOTHING when nothing is contributed, so a host can place it
 * unconditionally.</para>
 */
export function StatContributions({ slot }: StatContributionsProps) {
  /*
   * Untyped-by-slot read, the same route `useWidgetBadges` takes: the kit cannot
   * name a host widget's own slot id, so the entry type is asserted here against
   * the contract shape the registry declares for it.
   */
  const entries = useContributionsBySlotId(slot) as readonly StatEntry[];
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map((entry) => (
        <Stat
          key={entry.id}
          label={entry.label}
          detail={entry.detail}
          tone={entry.tone ?? "neutral"}
        >
          <StatFigure entry={entry} />
        </Stat>
      ))}
    </>
  );
}

/**
 * The figure: a quantity through `Unit`, else the entry's own text.
 *
 * A contributor hands over a `Value` and never a formatted number, so a
 * contributed figure ladders its unit and draws its symbol exactly as the host's
 * own do. `text` is the escape for a figure that has no unit to render (an
 * occupancy, a bare count of things); an entry carrying neither says nothing is
 * there rather than leaving the cell blank.
 */
function StatFigure({ entry }: { entry: StatEntry }) {
  /*
   * A `value` the contributor gave at all goes through `Unit`, `null` included:
   * Unit draws the null token itself, which is exactly the statement a
   * contributor asking for the cell with no reading to put in it is making.
   */
  if (entry.value !== undefined) return <Unit value={entry.value} />;
  if (entry.text !== undefined) return <>{entry.text}</>;
  return <NullValue />;
}
