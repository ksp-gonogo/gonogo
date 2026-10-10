import { Grid } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import type { SystemEntityMeta } from "./systemEntities";

// Swaps into AlmanacPanel's sidebar slot while a vessel is selected, rendering the roster fields `metaFor` already carries on each vessel entity.

const FIELD_LABELS: Readonly<Record<string, string>> = {
  type: "Type",
  situation: "Situation",
  body: "Body",
  crew: "Crew",
  comms: "Comms",
};

/** Row order for the fields `metaFor` produces; any other field still renders, appended after. */
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
          <Grid
            cols="1fr auto"
            gap="label-value"
            align="baseline"
            key={row.label}
          >
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

const WRAP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  // Matches AlmanacPanel's gutter: the two panels share one slot and must line up.
  padding: "var(--inset-frame-panel)",
  minWidth: 0,
  minHeight: 0,
  maxWidth: "100%",
  background: "var(--color-surface-panel)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-muted)",
};

const TITLE: CSSProperties = {
  fontSize: "var(--font-size-value)",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  letterSpacing: "0.04em",
};

const ROWS: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-line)",
  marginTop: "var(--gap-related-compact)",
};

const ROW_LABEL: CSSProperties = { color: "var(--color-text-faint)" };

const ROW_VALUE: CSSProperties = {
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
};
