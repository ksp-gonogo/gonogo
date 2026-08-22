import { Grid } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import type { SystemEntityMeta } from "./systemEntities";

/**
 * The `system-view.entities` info panel's selection payoff: swaps
 * into `AlmanacPanel`'s slot in `panelSidebar` when a vessel is selected,
 * showing the roster fields `vesselOrbitsContribution.ts`'s `metaFor`
 * already carries on every vessel entity (name/type/situation/body/crew/
 * comms), rather than re-reading the roster itself. Deselecting falls back
 * to the frame body's own `AlmanacPanel` (`index.tsx` owns that swap).
 */

const FIELD_LABELS: Readonly<Record<string, string>> = {
  type: "Type",
  situation: "Situation",
  body: "Body",
  crew: "Crew",
  comms: "Comms",
};

/** Row order for the meta fields `metaFor` produces; anything outside this
 *  set (a future contribution's extra field) still renders, appended after,
 *  in whatever order `Object.entries` yields it. */
const FIELD_ORDER = ["type", "situation", "body", "crew", "comms"];

export interface VesselInfoPanelProps {
  meta: SystemEntityMeta;
}

export function VesselInfoPanel({ meta }: VesselInfoPanelProps) {
  const title = typeof meta.name === "string" ? meta.name : "(unnamed)";
  const known = new Set(FIELD_ORDER);
  const rest = Object.keys(meta).filter((k) => k !== "name" && !known.has(k));
  const rows = [...FIELD_ORDER, ...rest]
    .filter((k) => meta[k] !== undefined)
    .map((k) => ({ label: FIELD_LABELS[k] ?? k, value: String(meta[k]) }));

  return (
    <Wrap>
      <div style={TITLE}>{title}</div>
      <div style={ROWS}>
        {rows.map((row) => (
          <Grid cols="1fr auto" gap="md" align="baseline" key={row.label}>
            <span style={ROW_LABEL}>{row.label}</span>
            <span style={ROW_VALUE}>{row.value}</span>
          </Grid>
        ))}
      </div>
    </Wrap>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  return <aside style={WRAP}>{children}</aside>;
}

// Same token-driven styling as AlmanacPanel's own local constants (that
// panel's are module-private, and the two panels occupy the same slot at
// different times, not simultaneously, so duplicating the handful of
// tokens here is cheaper than exporting/sharing them across a slot swap).

const WRAP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-8) var(--space-10)",
  minWidth: 0,
  minHeight: 0,
  maxWidth: "100%",
  background: "var(--color-surface-panel)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
};

const TITLE: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  letterSpacing: "0.04em",
};

const ROWS: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-hair)",
  marginTop: "var(--space-6)",
};

const ROW_LABEL: CSSProperties = { color: "var(--color-text-faint)" };

const ROW_VALUE: CSSProperties = {
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
};
