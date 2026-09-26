import { value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, Unit } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";

/** The throttle readback beside the dial: a fill bar over its percentage. */
export function ThrottleGauge({ throttle }: { throttle: number | null }) {
  return (
    <div style={THROTTLE_COLUMN}>
      <span style={THROTTLE_LABEL}>THR</span>
      <div style={THROTTLE_BAR}>
        {throttle !== null && (
          <div
            style={{
              ...THROTTLE_FILL,
              height: `${throttle * 100}%`,
            }}
          />
        )}
      </div>
      <span style={THROTTLE_VAL}>
        {throttle === null ? (
          NULL_DISPLAY
        ) : (
          <Unit value={value("%", throttle * 100)} decimals={0} />
        )}
      </span>
    </div>
  );
}

const THROTTLE_COLUMN: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--gap-related)",
  minWidth: "32px",
};

const THROTTLE_LABEL: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  color: "var(--color-text-faint)",
};

const THROTTLE_BAR: CSSProperties = {
  width: "14px",
  height: "100px",
  border: "1px solid var(--color-surface-raised)",
  background: "var(--color-surface-app)",
  position: "relative",
  overflow: "hidden",
};

const THROTTLE_FILL: CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  background: "var(--color-accent-fg)",
  // Off the motion scale: an 80ms chase of live throttle must not move when the UI motion tokens are retuned.
  transition: "height 80ms linear",
};

const THROTTLE_VAL: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
};
