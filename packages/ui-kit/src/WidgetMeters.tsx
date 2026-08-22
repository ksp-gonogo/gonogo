import type { MeterEntry } from "@ksp-gonogo/sitrep-sdk";
import type { CSSProperties } from "react";
import { useContributions } from "./contributionsRead";
import { Meter, MeterStack } from "./Meter";

// ---------------------------------------------------------------------------
// The framework-universal `meters` contribution segment, expressed by the
// component that draws it: the shape `FilterList` established for `filters`.
//
// The test for contribution-vs-augment is whether the host already has chrome
// for what the extension draws. For a stack of labelled 0..1 bars it plainly
// does: `Meter` is the single most-repeated data-bearing primitive in the kit,
// and the tree was already writing this same slot twice, once as DATA
// (`ship-map.part-meters`, a typed widget-owned contribution) and once as REACT
// (a per-crew-row augment whose entire render was a `Stack` of `Meter` and
// nothing else). An augment there buys nothing and costs the host every
// guarantee it would otherwise have: it cannot count what arrived, cannot order
// it, cannot lay it out with its own rows.
//
// `row` is what makes this reach where an augment SEGMENT cannot. A segment
// mounts once per widget and has no way to name a row, so per-row extension was
// the one shape §5 of the audit ruled uncollapsible. An entry carrying its own
// row key inverts that: the host mounts one `<WidgetMeters row={...}>` per row
// and each entry lands beside the datum it is about.
// ---------------------------------------------------------------------------

export interface WidgetMetersProps {
  /**
   * Render only the meters addressed at this row (a kerbal's name, a part id).
   * Omit in a whole-widget stack, which then shows only entries carrying no
   * `row` of their own: a row-addressed meter must never fall out into the body
   * because the host forgot to name a row.
   */
  row?: string;
  /** Bar size, forwarded to every meter so one stack stays uniform. */
  size?: "sm" | "md";
  /**
   * Layout for the stack (an indent under a row, a max width). On the stack
   * rather than on a wrapper the host renders, so an empty stack still renders
   * NOTHING: a host wrapper would leave its own padding behind on every row
   * that got no meters.
   */
  style?: CSSProperties;
}

/**
 * Every meter contributed to the mounting widget's `${componentId}.meters`
 * slot, drawn through the kit's own `Meter`.
 *
 * Renders NOTHING when nothing is contributed: no stack, no spacing, no empty
 * state. A host can therefore place it unconditionally, which is the whole
 * point of a universal seam.
 */
export function WidgetMeters({ row, size = "sm", style }: WidgetMetersProps) {
  const entries = useContributions("meters") as readonly MeterEntry[];
  const mine = entries.filter((entry) => entry.row === row);
  if (mine.length === 0) return null;

  return (
    <MeterStack style={style} aria-label="meters">
      {mine.map((entry) => (
        <Meter
          key={entry.id}
          size={size}
          label={entry.label}
          value={entry.value}
          tone={entry.tone}
          valueLabel={entry.valueLabel}
        />
      ))}
    </MeterStack>
  );
}
