import type { StatEntry } from "@ksp-gonogo/sitrep-sdk";
import { useContributionsBySlotId } from "./contributionsRead";
import { NullValue } from "./NullValue";
import { Stat } from "./Stat";
import { Unit } from "./Unit";

/**
 * Props for {@link StatContributions}.
 *
 * @category Readout
 */
export interface StatContributionsProps {
  /**
   * The widget-led slot the host declared, in full
   * (`"astronaut-complex.readouts"`), not a bare segment.
   */
  slot: string;
}

/**
 * Every stat contributed to `slot`, drawn through the kit's own {@link Stat}.
 *
 * A fragment, not a wrapper: the cells land in the host's own
 * {@link StatStrip} as siblings of its built-in ones. Renders nothing when
 * nothing is contributed, so a host can place it unconditionally. An entry's
 * quantity is drawn through {@link Unit}, else its text, else the null token.
 *
 * @example
 * ```tsx
 * <StatStrip>
 *   <Stat label="Funds"><Unit value={funds} /></Stat>
 *   <StatContributions slot="astronaut-complex.readouts" />
 * </StatStrip>
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
function StatFigure({ entry }: { entry: StatEntry }) {
  // A `null` value still goes through `Unit`, which draws the null token itself.
  if (entry.value !== undefined) return <Unit value={entry.value} />;
  if (entry.text !== undefined) return <>{entry.text}</>;
  return <NullValue />;
}
