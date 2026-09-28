import type { CSSProperties, ReactNode } from "react";

// Plain elements rather than ui-kit Value: its tones have no slot for ap/pe/alert, and the sizes are off-scale on purpose.

export function OrbitLabel({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: "var(--font-size-caption)",
        color: "var(--color-text-faint)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Stands in for a quantity that does not exist in the operator's view frame.
 * Words, not the null dash: the dash means "absent on this trajectory", this is a fact about the frame they can change.
 */
export function FrameCaveat({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        fontSize: "var(--font-size-compact)",
        color: "var(--color-text-faint)",
        fontStyle: "italic",
      }}
    >
      {children}
    </span>
  );
}

export type OrbitAccent = "ap" | "pe" | "alert";

const ACCENT_COLOR: Record<OrbitAccent, string> = {
  ap: "var(--color-warn-mark)",
  pe: "var(--color-tag-blue-fg)",
  alert: "var(--color-nogo-mark)",
};

/** The smaller tiers of the value ladder, or undefined at the base size. */
function smallerTierFontSize(
  tight: boolean,
  narrow: boolean,
): string | undefined {
  if (tight) return "var(--font-size-caption)";
  // A literal 12px for the same reason as the base 13px.
  if (narrow) return "12px";
  return undefined;
}

export function OrbitValue({
  accent,
  tight,
  narrow,
  children,
}: {
  accent?: OrbitAccent;
  tight: boolean;
  narrow: boolean;
  children: ReactNode;
}) {
  const style: CSSProperties = {
    // Off-scale on purpose: a 13/12/10 ladder, and --font-size-sm would merge the base and narrow tiers.
    fontSize: smallerTierFontSize(tight, narrow) ?? "13px",
    color: accent ? ACCENT_COLOR[accent] : "var(--color-text-primary)",
    letterSpacing: "0.03em",
    whiteSpace: "nowrap",
    minWidth: 0,
  };
  return <span style={style}>{children}</span>;
}
