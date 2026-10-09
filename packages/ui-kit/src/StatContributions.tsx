import type { StatEntry } from "@ksp-gonogo/sitrep-sdk";
import { useContributionsBySlotId } from "./contributionsRead";
import { HeldFigure } from "./HeldMark";
import { NullValue } from "./NullValue";
import { heldMarking } from "./readingCurrency";
import { Stat } from "./Stat";
import { Unit } from "./Unit";

/**
 * Props for {@link StatContributions}.
 *
 * @category Readout
 */
export interface StatContributionsProps {
  /**
   * The full slot id the host widget declared (`"astronaut-complex.readouts"`),
   * not a bare segment.
   */
  slot: string;
}

/**
 * Every stat contributed to `slot`, drawn through the kit's own {@link Stat}.
 *
 * A fragment, not a wrapper: the cells land in the host's own `Grid` of stats
 * as siblings of its built-in ones. Renders nothing when
 * nothing is contributed, so a host can place it unconditionally. An entry's
 * quantity is drawn through {@link Unit}, else its text, else the null token;
 * a held figure is drawn with the held mark either way.
 *
 * @example
 * ```tsx
 * <Grid minColWidth="7rem" fit align="stretch" gap="related-compact">
 *   <Stat label="Funds"><Unit value={funds} /></Stat>
 *   <StatContributions slot="astronaut-complex.readouts" />
 * </Grid>
 * ```
 *
 * @category Readout
 */
export function StatContributions({ slot }: StatContributionsProps) {
  // The kit cannot name a host widget's slot id, so the entry type is asserted against the contract shape.
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
 * The figure: a quantity through `Unit`, else the entry's own text. An entry
 * carrying neither draws the null token rather than a blank cell.
 */
export function StatFigure({ entry }: { entry: StatEntry }) {
  // A `null` value still goes through `Unit`, which draws the null token itself.
  if (entry.value !== undefined) return <Unit value={entry.value} />;
  if (entry.text === undefined) return <NullValue />;
  const marking = heldMarking(entry.held);
  if (marking === null) return <>{entry.text}</>;
  return (
    <HeldFigure kind={marking.kind} caption={marking.caption}>
      {entry.text}
    </HeldFigure>
  );
}
