import type { MeterEntry } from "@ksp-gonogo/sitrep-sdk";
import type { CSSProperties } from "react";
import { useContributions } from "./contributionsRead";
import { Meter, MeterStack } from "./Meter";

/**
 * Props for {@link WidgetMeters}.
 *
 * @category Meter
 */
export interface WidgetMetersProps {
  /**
   * Render only the meters addressed at this row (a kerbal's name, a part id).
   * Omit in a whole-widget stack, which then shows only entries carrying no
   * `row` of their own. A row-addressed meter never appears in a stack that
   * names no row.
   */
  row?: string;
  /**
   * Inline style for the stack (an indent under a row, a max width). It sits
   * on the stack itself, so a row with no meters leaves no padding behind.
   */
  style?: CSSProperties;
}

/**
 * Every meter contributed to the mounting widget's `${componentId}.meters`
 * slot, drawn as a {@link MeterStack} of {@link Meter}s.
 *
 * Renders nothing when nothing is contributed, so a host can place it
 * unconditionally, one per row.
 *
 * An entry whose `value` is a whole `Reading` is passed to {@link Meter} as
 * is, so its band and held state are drawn the same whichever Uplink sent the
 * entry.
 *
 * @example Under each crew row, the meters Uplinks addressed to that kerbal
 * ```tsx
 * <li key={name}>
 *   {name}
 *   <WidgetMeters row={name} />
 * </li>
 * ```
 *
 * @category Meter
 */
export function WidgetMeters({ row, style }: WidgetMetersProps) {
  const entries = useContributions("meters") as readonly MeterEntry[];
  const mine = entries.filter((entry) => entry.row === row);
  if (mine.length === 0) return null;

  return (
    <MeterStack style={style} role="group" aria-label="meters">
      {mine.map((entry) => (
        <Meter
          key={entry.id}
          label={entry.label}
          value={entry.value}
          tone={entry.tone}
          valueLabel={entry.valueLabel}
        />
      ))}
    </MeterStack>
  );
}
