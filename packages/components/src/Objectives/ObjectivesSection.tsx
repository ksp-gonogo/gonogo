import { VisuallyHidden } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import type { ObjectiveSection, ObjectiveState } from "./types";

const STATE_GLYPH: Record<ObjectiveState, string> = {
  pending: "○",
  active: "◐",
  reached: "●",
  failed: "✕",
};

/** Renders one source's items, or nothing when empty so the frame's fallback can show. */
export function ObjectivesSection({ items, renderAlarm }: ObjectiveSection) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Objectives" style={LIST}>
      {items.map((o) => (
        <li key={o.id} style={ITEM}>
          <span
            style={{ ...GLYPH, color: STATE_COLOR[o.state] }}
            aria-hidden="true"
          >
            {STATE_GLYPH[o.state]}
          </span>
          <div style={TEXT}>
            <span
              style={
                o.state === "pending"
                  ? { ...TITLE, color: "var(--color-text-muted)" }
                  : TITLE
              }
            >
              {o.title}
              {o.optional && <span style={OPTIONAL}> (optional)</span>}
            </span>
            <span style={SOURCED}>{o.source}</span>
            {o.description && <span style={DESC}>{o.description}</span>}
          </div>
          <VisuallyHidden>{o.state}</VisuallyHidden>
          {renderAlarm?.(o)}
        </li>
      ))}
    </ul>
  );
}

const STATE_COLOR: Record<ObjectiveState, string> = {
  pending: "var(--color-text-muted)",
  active: "var(--color-status-go-fg)",
  reached: "var(--color-status-go-fg)",
  failed: "var(--color-status-nogo-fg)",
};

const LIST: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
};

const ITEM: CSSProperties = {
  display: "flex",
  gap: "var(--gap-related)",
  alignItems: "baseline",
};

const GLYPH: CSSProperties = { fontSize: "var(--font-size-xs)" };

const TEXT: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-line)",
  minWidth: 0,
  flex: "1 1 auto",
};

const TITLE: CSSProperties = { fontSize: "var(--font-size-value)" };

const OPTIONAL: CSSProperties = {
  color: "var(--color-text-muted)",
  fontStyle: "italic",
};

const SOURCED: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.03em",
};

const DESC: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-muted)",
};
