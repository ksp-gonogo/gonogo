import { Button } from "@ksp-gonogo/ui-kit";
import type { ButtonHTMLAttributes, CSSProperties } from "react";

export const BODY_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
} as const;

export type RateTone = "physics" | "high";

/**
 * Physics warp tints amber: at speed in atmosphere the operator needs to know
 * it is not on-rails.
 */
export function rateStyle(tone: RateTone) {
  return {
    flex: "1 1 70px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--gap-related)",
    minWidth: 0,
    color:
      tone === "physics" ? "var(--color-warn-mark)" : "var(--color-go-text)",
  } as const;
}

/* Off the type scale, which stops at --font-size-lg: this is a display-tier readout. */
export const RATE_VALUE_STYLE = {
  fontSize: "24px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  lineHeight: "var(--line-height-flush)",
} as const;

/* minWidth 0 lets the grid shrink below its 8-button min-content instead of clipping. */
export const FULL_LADDER_STYLE = {
  flex: "2 1 140px",
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(40px, 1fr))",
  gap: "var(--gap-related)",
  alignContent: "center",
} as const;

export const STEP_LADDER_STYLE = {
  flex: "1 1 100px",
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(28px, 1fr))",
  gap: "var(--gap-related)",
  alignContent: "center",
} as const;

/* The warp-to targets take the widget's whole width, so the instant's fields lie in one row. */
export const WARP_TO_STYLE = { flex: "1 1 100%", minWidth: 0 } as const;

/* The buttons and the alarm row under them, as one column beside the rate readout. */
export const CONTROLS_STYLE = {
  flex: "3 1 180px",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
} as const;

export const CONTROL_ROW_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
} as const;

/* A row of its own under the buttons. */
export const FOOT_ROW_STYLE = {
  minWidth: 0,
} as const;

/* Sized to the name rather than filling the row, so the countdown sits beside it. */
export const ALARM_NAME_STYLE = {
  flex: "0 1 auto",
  fontSize: "var(--font-size-sm)",
} as const;

/**
 * The kit's `Button`, geometry pinned back to the compact grid this control
 * needs: its own `pressed` look already matches the lit state exactly
 * (`--color-go-status` fill, `--color-go-on-status` text), so only the rest
 * state and sizing need an override. `pressed` is passed as `true` or
 * `undefined`, never `false`, so a momentary stepper (+/−, no
 * `aria-pressed` of its own) never picks one up: `Button` writes
 * `aria-pressed` from this prop, and a caller that wants the attribute sets
 * its own `aria-pressed`, which lands after this in the props and wins.
 */
export function WarpButton({
  $active,
  style,
  ...rest
}: Readonly<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    $active: boolean;
    style?: CSSProperties;
  }
>) {
  return (
    <Button
      pressed={$active ? true : undefined}
      style={{
        ...WARP_BUTTON_GEOMETRY,
        ...($active ? WARP_BUTTON_ACTIVE : WARP_BUTTON_REST),
        ...style,
      }}
      {...rest}
    />
  );
}

const WARP_BUTTON_GEOMETRY: CSSProperties = {
  minHeight: 0,
  lineHeight: "normal",
  padding: "var(--inset-warp-button)",
  fontSize: "var(--font-size-compact)",
  letterSpacing: "0.04em",
  minWidth: 0,
};

const WARP_BUTTON_ACTIVE: CSSProperties = { fontWeight: 700 };

const WARP_BUTTON_REST: CSSProperties = {
  fontWeight: 500,
  borderColor: "var(--color-border-subtle)",
  color: "var(--color-go-on-status)",
};
