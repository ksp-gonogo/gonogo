import type { HeldGrade } from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  HeldFigure,
  heldGradeOf,
  heldWord,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import type {
  ObjectiveAwaitingHome,
  ObjectiveSection,
  ObjectiveState,
} from "./types";

const STATE_GLYPH: Record<ObjectiveState, string> = {
  pending: "○",
  active: "◐",
  reached: "●",
  failed: "✕",
};

/** Renders one source's items, or nothing when empty so the frame's fallback can show. */
export function ObjectivesSection({
  items,
  renderAlarm,
  held,
}: ObjectiveSection) {
  if (items.length === 0) return null;
  const grade = heldGradeOf(held);
  return (
    <ul aria-label="Objectives" style={LIST}>
      {items.map((o) => (
        <li
          key={o.id}
          style={o.depth ? { ...ITEM, marginLeft: `${o.depth * 1.5}ch` } : ITEM}
        >
          <StateGlyph
            glyph={
              <span
                style={{ ...GLYPH, color: STATE_COLOR[o.state] }}
                aria-hidden="true"
              >
                {STATE_GLYPH[o.state]}
              </span>
            }
            held={grade}
          />
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
            <span style={SOURCED}>
              {o.source}
              {o.awaitingHome && <AwaitingHome awaiting={o.awaitingHome} />}
            </span>
            {o.description && <span style={DESC}>{o.description}</span>}
          </div>
          <VisuallyHidden>{o.state}</VisuallyHidden>
          {renderAlarm?.(o)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Appended to a contract's line when a vessel has completed it and home has
 * not heard: inline caption text, so the row keeps its shape.
 */
function AwaitingHome({
  awaiting,
}: Readonly<{ awaiting: ObjectiveAwaitingHome }>) {
  if (awaiting.homeHearsInSeconds === null) {
    return <> · complete, home cannot hear yet</>;
  }
  return (
    <>
      {" · complete, home hears in "}
      <Countdown value={awaiting.homeHearsInSeconds} />
    </>
  );
}

/** An item's state glyph, carrying the held square while the source's reading is held. */
function StateGlyph({
  glyph,
  held,
}: Readonly<{ glyph: ReactNode; held: HeldGrade | undefined }>) {
  if (held === undefined) return <>{glyph}</>;
  return <HeldFigure caption={heldWord(held)}>{glyph}</HeldFigure>;
}

const STATE_COLOR: Record<ObjectiveState, string> = {
  pending: "var(--color-text-muted)",
  active: "var(--color-go-text)",
  reached: "var(--color-go-text)",
  failed: "var(--color-nogo-text)",
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
