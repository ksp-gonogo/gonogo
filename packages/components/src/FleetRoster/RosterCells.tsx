import { Truncate } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { TONE_MARK, TONE_TEXT, type Tone } from "./comms";

/** Decorative colour-coded link marker; its `aria-label` carries the meaning. */
export function LinkDot({
  tone,
  ariaLabel,
}: {
  tone: Tone;
  ariaLabel: string;
}) {
  return (
    <span
      role="img"
      aria-label={ariaLabel}
      style={{
        flex: "0 0 auto",
        width: 8,
        height: 8,
        borderRadius: "var(--radius-circle)",
        background: TONE_MARK[tone],
      }}
    />
  );
}

/** Outline chip: border and text both read the tone colour, unlike the filled `Badge` pill. */
export function CommsTag({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        fontSize: "var(--font-size-caption)",
        letterSpacing: "0.05em",
        fontWeight: 600,
        padding: "var(--inset-chip)",
        borderRadius: "var(--radius-regular)",
        border: `1px solid ${TONE_TEXT[tone]}`,
        color: TONE_TEXT[tone],
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Column header label; truncates like a body cell since the Vessel track shrinks below "VESSEL" at minSize. */
export function ColLabel({
  right,
  children,
}: {
  right?: boolean;
  children: ReactNode;
}) {
  return (
    <Truncate
      style={{
        fontSize: "var(--font-size-caption)",
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 600,
        padding: "var(--inset-roster-cell)",
        textAlign: right ? "right" : "left",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Truncate>
  );
}
