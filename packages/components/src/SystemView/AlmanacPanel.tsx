import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { ExpandableText, Grid } from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import { buildRows } from "./almanacRows";
import type { CatalogueHeld, CelestialBody } from "./useCelestialBodies";

export interface AlmanacPanelProps {
  /** Body to describe. When null, the panel renders an idle hint. */
  body: CelestialBody | null;
  /** Phase angle to the active vessel, with the model's figure where one reaches past the received edge. Suppressed for the vessel's parent. */
  phaseAngle?: Reading<Value<"°">> | null;
  /** Whether this body is the vessel's current parent, phase angle is meaningless. */
  isVesselParent?: boolean;
  /** Hohmann ideal departure phase angle (deg), if the vessel and body share a parent. */
  hohmannIdealDeg?: number | null;
  /** Signed delta from ideal (deg). Negative = early; positive = late. */
  hohmannDeltaDeg?: number | null;
  /** SOI event direction when this body is the vessel's upcoming encounter or escape destination; the caller matches `o.encounterBody` to the panel body first. */
  encounterDirection?: "encounter" | "escape" | null;
  /** Time until the SOI transition. */
  encounterIn?: Reading<Value<"s">> | null;
  /** Next apsis on the *vessel's* orbit: 1 = Ap, -1 = Pe. Only shown when `isVesselParent`. */
  nextApsisType?: -1 | 1 | null;
  /** Time to the next apsis. */
  nextApsisIn?: Reading<Value<"s">> | null;
  /** Set while the catalogue has stopped arriving, so its live figures are marked held. */
  held?: CatalogueHeld | null;
}

export function AlmanacPanel({
  body,
  phaseAngle = null,
  isVesselParent = false,
  hohmannIdealDeg = null,
  hohmannDeltaDeg = null,
  encounterDirection = null,
  encounterIn = null,
  nextApsisType = null,
  nextApsisIn = null,
  held = null,
}: AlmanacPanelProps) {
  if (!body) {
    return (
      <Wrap>
        <div style={HINT}>
          Hover or focus a body in the diagram for almanac data, or pick the
          vessel's parent body to see its details.
        </div>
      </Wrap>
    );
  }
  const rows = buildRows(
    body,
    phaseAngle,
    isVesselParent,
    hohmannIdealDeg,
    hohmannDeltaDeg,
    encounterDirection,
    encounterIn,
    nextApsisType,
    nextApsisIn,
    held,
  );
  return (
    <Wrap>
      <div style={TITLE}>{body.name ?? "(unnamed)"}</div>
      {body.referenceBody && (
        <div style={SUB}>orbiting {body.referenceBody}</div>
      )}
      <div style={ROWS}>
        {rows.length === 0 ? (
          <div style={HINT}>Awaiting body data...</div>
        ) : (
          rows.map((row) => (
            <Grid
              cols="1fr auto"
              gap="label-value"
              align="baseline"
              key={`${row.label}=${row.value}`}
            >
              <span style={ROW_LABEL}>{row.label}</span>
              <span style={ROW_VALUE}>{row.value}</span>
            </Grid>
          ))
        )}
      </div>
      {body.description && !/^#autoLOC/i.test(body.description.trim()) && (
        <p style={DESCRIPTION}>
          <ExpandableText subject={body.name ?? undefined}>
            {body.description}
          </ExpandableText>
        </p>
      )}
    </Wrap>
  );
}

// The enclosing FramedDisplay's edge divides this panel from the diagram, so it draws no border.
const WRAP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  padding: "var(--inset-frame-panel)",
  minWidth: 0,
  // Grid items default to min-height:auto, which would grow past the sidebar cell instead of letting its scroller engage.
  minHeight: 0,
  maxWidth: "100%",
  background: "var(--color-surface-panel)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-muted)",
};

function Wrap({ children }: { children: ReactNode }) {
  // Panel.Sidebar supplies the scroller.
  return <aside style={WRAP}>{children}</aside>;
}

const TITLE: CSSProperties = {
  fontSize: "var(--font-size-value)",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  letterSpacing: "0.04em",
};

const SUB: CSSProperties = {
  color: "var(--color-text-faint)",
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.05em",
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

const HINT: CSSProperties = {
  color: "var(--color-text-faint)",
  fontSize: "var(--font-size-compact)",
  lineHeight: "var(--line-height-body)",
};

const DESCRIPTION: CSSProperties = {
  margin: "var(--gap-related-comfortable) 0 0",
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-compact)",
  lineHeight: "var(--line-height-body)",
  whiteSpace: "pre-wrap",
};
