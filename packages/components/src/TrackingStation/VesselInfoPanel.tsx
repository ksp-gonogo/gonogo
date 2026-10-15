import { Grid } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import {
  useCatalogVessel,
  VesselCatalogEntry,
} from "../VesselCatalog/VesselCatalogEntry";
import type { SystemEntityMeta } from "./systemEntities";

// Swaps into AlmanacPanel's sidebar slot while a vessel is selected, rendering the fields `metaFor` carries on each vessel entity and, for a craft the Vessel Catalog lists, its catalog entry.

const FIELD_LABELS: Readonly<Record<string, string>> = {
  type: "Type",
  situation: "Situation",
  body: "Body",
  site: "Site",
  position: "Position",
  crew: "Crew",
  comms: "Comms",
};

/** Row order for the fields `metaFor` produces; any other field still renders, appended after. */
const FIELD_ORDER = [
  "type",
  "situation",
  "body",
  "site",
  "position",
  "crew",
  "comms",
];

export interface VesselInfoPanelProps {
  meta: SystemEntityMeta;
  /** The selected craft's id, which finds its Vessel Catalog entry; absent shows the meta alone. */
  vesselId?: string | null;
}

export function VesselInfoPanel({
  meta,
  vesselId = null,
}: VesselInfoPanelProps) {
  const catalog = useCatalogVessel(vesselId);
  const title = typeof meta.name === "string" ? meta.name : "(unnamed)";
  const known = new Set(FIELD_ORDER);
  const rest = Object.keys(meta).filter((k) => k !== "name" && !known.has(k));
  const rows = [...FIELD_ORDER, ...rest]
    .filter((k) => meta[k] !== undefined)
    // The catalog entry's Link and Crew rows say what these would, with the signal delay and what is known of the crew behind them.
    .filter(
      (k) =>
        catalog === null ||
        (k !== "comms" && (k !== "crew" || catalog.vessel.crew == null)),
    )
    .map((k) => ({ label: FIELD_LABELS[k] ?? k, value: String(meta[k]) }));

  return (
    <Wrap label={title}>
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
      {catalog !== null && (
        <VesselCatalogEntry
          vessel={catalog.vessel}
          contactHeld={catalog.contactHeld}
        />
      )}
    </Wrap>
  );
}

function Wrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside style={WRAP} aria-label={label}>
      {children}
    </aside>
  );
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
