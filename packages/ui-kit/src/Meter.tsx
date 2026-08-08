import { value as quantity } from "@ksp-gonogo/sitrep-sdk";
import type { HTMLAttributes } from "react";
import styled, { css } from "styled-components";
import { Unit } from "./Unit";
import { speakQuantity } from "./units";

export type MeterTone = "neutral" | "go" | "warn" | "nogo" | "info";
export type MeterSize = "sm" | "md";

export interface MeterProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Short label shown above the bar and used as the meter's accessible name. */
  label: string;
  /** Fill fraction, 0..1. Clamped; non-finite renders empty. */
  value: number;
  /** Semantic colour of the fill. */
  tone?: MeterTone;
  /** Text shown on the right of the header (e.g. "5.0 rad/h"). Defaults to a percentage. */
  valueLabel?: string;
  size?: MeterSize;
}

/**
 * A labelled horizontal fill bar: the shared visual language for any 0..1
 * quantity (dose, shielding, hunger, resource level, reliability). Pool several
 * into a uniform stack (see `MeterStack`) so a widget's readouts line up.
 *
 * Semantics: the track is `role="meter"` with `aria-valuenow/min/max` and
 * `aria-valuetext` (the human `valueLabel`), named by `label`. Colour never
 * carries meaning alone: the header always shows the value in text.
 */
export function Meter({
  label,
  value,
  tone = "neutral",
  valueLabel,
  size = "md",
  ...rest
}: MeterProps) {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const pct = Math.round(clamped * 100);
  // `value` is a 0..1 ratio, which is a unit the kit knows, so <Unit> does the
  // *100 and writes the symbol. `valueLabel` still wins when a caller has a
  // better sentence than a bare percentage.
  //
  // Two forms, because they go to two places. The visible one is a NODE, so
  // the symbol keeps its own styling; `aria-valuetext` is an attribute and can
  // only hold a string, which is what `speakQuantity` is for. Writing one
  // string for both is what the unit layer exists to stop: it would announce
  // "72 percent-sign".
  const reading = quantity("ratio", clamped);
  const display = valueLabel ?? <Unit value={reading} />;
  const spoken = valueLabel ?? speakQuantity(reading);
  return (
    <Meter__Root $size={size} {...rest}>
      <Meter__Head>
        <Meter__Label>{label}</Meter__Label>
        <Meter__Value>{display}</Meter__Value>
      </Meter__Head>
      <Meter__Track
        $size={size}
        role="meter"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={spoken}
      >
        <Meter__Fill $tone={tone} style={{ width: `${pct}%` }} />
      </Meter__Track>
    </Meter__Root>
  );
}

/** Uniform vertical stack of meters with consistent spacing. */
export const MeterStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  width: 100%;
`;

const TONE_FILL = {
  neutral: css`
    background: var(--color-text-muted);
  `,
  go: css`
    background: var(--color-status-go-bg);
  `,
  warn: css`
    background: var(--color-status-warning-bg);
  `,
  nogo: css`
    background: var(--color-status-nogo-bg);
  `,
  info: css`
    background: var(--color-status-info-bg);
  `,
} as const;

const SIZE_TRACK = {
  sm: css`
    height: 4px;
  `,
  md: css`
    height: 8px;
  `,
} as const;

const Meter__Root = styled.div<{ $size: MeterSize }>`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
`;

const Meter__Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-8);
  min-width: 0;
`;

const Meter__Label = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Meter__Value = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex: 0 0 auto;
`;

const Meter__Track = styled.div<{ $size: MeterSize }>`
  width: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
  ${({ $size }) => SIZE_TRACK[$size]}
`;

const Meter__Fill = styled.div<{ $tone: MeterTone }>`
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--duration-slow) var(--ease-standard);
  ${({ $tone }) => TONE_FILL[$tone]}

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;
