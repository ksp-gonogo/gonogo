import { Badge, ScrollArea } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import type { StageEntry } from "./stageStack";

/** The widest tile, in grid columns, that shows the stage list alone. */
export const STAGE_LIST_ONLY_MAX_COLUMNS = 5;

/** Whether a tile this many grid columns wide gives the whole body to the stage list. */
export function showsStagesOnly(columns: number | undefined): boolean {
  return columns !== undefined && columns <= STAGE_LIST_ONLY_MAX_COLUMNS;
}

/**
 * The craft's staging stack as the in-game display lists it: the stage still to
 * fire at the top, each with the titles of its parts and how many of each. The
 * stage the next press of the stage control fires carries a "Next" badge, and
 * only while the stage number is a current reading. Stages already fired are
 * not listed, as in game. Used as the Ship Map's sidebar, and alone in its body on a tile five columns wide or less.
 */
export function StageColumn({
  stages,
  fill = false,
}: {
  stages: StageEntry[];
  /** Fills the whole body, with no diagram. */
  fill?: boolean;
}) {
  return (
    // The scroll area takes keyboard focus, with its ring, only when the stages outgrow the tile.
    <section aria-label="Staging" style={fill ? COLUMN_ALONE : COLUMN}>
      <ScrollArea>
        <div style={CONTENT}>
          <h3 style={HEADING}>Stages</h3>
          <ol style={LIST}>
            {stages.map((s) => (
              <li
                key={s.stage}
                aria-current={s.current ? "step" : undefined}
                style={s.current ? ROW_CURRENT : ROW}
              >
                <div style={ROW_HEAD}>
                  <span style={STAGE_NUMBER}>Stage {s.stage}</span>
                  {s.current && (
                    <Badge tone="info" size="sm">
                      Next
                    </Badge>
                  )}
                </div>
                <ul style={PARTS}>
                  {s.parts.map((p) => (
                    <li key={p.title} style={PART}>
                      {p.title}
                      {p.count > 1 && (
                        <span style={COUNT}>
                          <span aria-hidden="true"> ×{p.count}</span>
                          <span style={SR_ONLY}> times {p.count}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </ScrollArea>
    </section>
  );
}

const COLUMN: CSSProperties = {
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  fontSize: "var(--font-size-compact)",
};

const COLUMN_ALONE: CSSProperties = {
  ...COLUMN,
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  boxSizing: "border-box",
};

const CONTENT: CSSProperties = { padding: "var(--inset-surface)" };

const HEADING: CSSProperties = {
  margin: 0,
  marginBottom: "var(--gap-related)",
  fontSize: "var(--font-size-compact)",
  fontWeight: "normal",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
};

const LIST: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
};

const ROW: CSSProperties = {
  padding: "var(--gap-related)",
  borderLeft: "2px solid var(--color-border-subtle)",
};

// The border is a second cue beside the badge, so the marked row is not told apart by colour alone.
const ROW_CURRENT: CSSProperties = {
  ...ROW,
  borderLeft: "4px solid var(--color-text-muted)",
  background: "var(--color-surface-app)",
};

const ROW_HEAD: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--gap-related)",
  color: "var(--color-text-muted)",
};

const STAGE_NUMBER: CSSProperties = { fontWeight: "bold" };

const PARTS: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  color: "var(--color-text-muted)",
};

const PART: CSSProperties = { overflowWrap: "anywhere" };

const COUNT: CSSProperties = { color: "var(--color-text-faint)" };

const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};
