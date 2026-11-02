import { NULL_DISPLAY, Panel, Section } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

/** The panel chrome shared by every branch, so the badges slot and title cannot drift. */
export function TargetPanel({ children }: { children: ReactNode }) {
  return (
    <Panel panelTitle="TARGET" sections={<Section full>{children}</Section>} />
  );
}

// Display tier above the type scale; DisplayDash must stay equal to this.
export const DISPLAY_VALUE_STYLE = {
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: "0.02em",
  lineHeight: "var(--line-height-tight)",
} as const;

/** Same display tier as the value it stands in for, shown while a distance has not arrived. */
export function DisplayDash() {
  return (
    <span
      style={{
        fontSize: 22,
        fontWeight: 600,
        color: "var(--color-text-faint)",
      }}
    >
      {NULL_DISPLAY}
    </span>
  );
}
