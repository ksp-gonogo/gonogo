import { Unit } from "@ksp-gonogo/ui-kit";
import type { ComponentProps } from "react";

type UnitValue = ComponentProps<typeof Unit>["value"];

/** One labelled figure of a plot readout. A figure that is absent is drawn as the null token by its unit. */
export interface ReadoutRow {
  label: string;
  value: UnitValue;
  decimals?: number;
  /** Presentation-only unit to write the figure in, such as `°C`. */
  as?: ComponentProps<typeof Unit>["as"];
}

/**
 * The present values a plot shows beside or over itself, one labelled figure
 * per row. Useful for giving the operator the figures behind the craft's mark
 * on the plot. `stacked` puts each figure under its label, for a card with
 * little width. Used by the graph widgets, through the plot readout slot of
 * the graph view.
 */
export function ReadoutRows({
  rows,
  stacked = false,
}: {
  rows: readonly ReadoutRow[];
  stacked?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={stacked ? STACKED_STYLE : SIDE_BY_SIDE_STYLE}
    >
      {rows.map((row) => (
        <div key={row.label} style={stacked ? STACKED_ROW : CONTENTS_ROW}>
          <span style={LABEL_STYLE}>{row.label}</span>
          <span style={VALUE_STYLE}>
            <Unit value={row.value} decimals={row.decimals} as={row.as} />
          </span>
        </div>
      ))}
    </div>
  );
}

const COMMON = {
  fontSize: "var(--font-size-compact)",
  fontVariantNumeric: "tabular-nums",
} as const;

/* Labels share one column and figures another, so the figures line up whatever the labels' lengths. */
const SIDE_BY_SIDE_STYLE = {
  ...COMMON,
  display: "grid",
  gridTemplateColumns: "max-content auto",
  columnGap: "var(--gap-related)",
  rowGap: "var(--gap-line)",
  alignItems: "baseline",
} as const;

const STACKED_STYLE = {
  ...COMMON,
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-line)",
} as const;

const CONTENTS_ROW = { display: "contents" } as const;

const STACKED_ROW = {
  display: "flex",
  flexDirection: "column",
} as const;

const LABEL_STYLE = {
  color: "var(--color-text-faint)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  fontSize: "var(--font-size-caption)",
} as const;

const VALUE_STYLE = {
  color: "var(--color-text-primary)",
  fontSize: "var(--font-size-value)",
} as const;
