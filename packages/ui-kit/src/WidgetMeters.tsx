import type { MeterEntry } from "@ksp-gonogo/sitrep-sdk";
import type { CSSProperties } from "react";
import { useContributions } from "./contributionsRead";
import { Meter, MeterStack } from "./Meter";

export interface WidgetMetersProps {
  /**
   * Render only the meters addressed at this row (a kerbal's name, a part id).
   * Omit in a whole-widget stack, which then shows only entries carrying no
   * `row` of their own: a row-addressed meter must never fall out into the body
   * because the host forgot to name a row.
   */
  row?: string;
  /**
   * Layout for the stack (an indent under a row, a max width). On the stack
   * rather than a host wrapper, so a row with no meters leaves no padding
   * behind.
   */
  style?: CSSProperties;
}

/**
 * Every meter contributed to the mounting widget's `${componentId}.meters`
 * slot, drawn through the kit's own `Meter`.
 *
 * Renders nothing when nothing is contributed, so a host can place it
 * unconditionally, one per row.
 *
 * An entry whose `value` is a whole `Reading` goes over unopened: `Meter` finds
 * and draws its band, so doubt looks the same whichever Uplink sent the entry.
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
