import { Badge } from "@ksp-gonogo/ui-kit";
import { type CSSProperties, useEffect, useState } from "react";
import { ROTATE_MIN_WIDTH } from "./ShipDiagram";
import type { StageEntry } from "./stageStack";

/** The width of the stage column, in pixels. */
const STAGE_COLUMN_WIDTH = 136;

/** The widget width, in pixels, below which the diagram and the stage column no longer fit side by side, so the diagram is drawn alone. */
export const STAGE_COLUMN_MIN_WIDGET_WIDTH =
  ROTATE_MIN_WIDTH + STAGE_COLUMN_WIDTH;

/** The widest tile, in grid columns, that shows the stage list alone. */
export const STAGE_LIST_ONLY_MAX_COLUMNS = 5;

export type ShipMapLayout = "both" | "diagram" | "stages";

/**
 * What a tile carries: the stage list alone when it spans at most
 * `STAGE_LIST_ONLY_MAX_COLUMNS` grid columns, otherwise the diagram and the stage
 * column side by side when the container is wide enough, or the diagram alone.
 * Reads as both until the container has been measured, so a first paint and an
 * environment with no resize observer both keep the column.
 */
export function useShipMapLayout(
  el: HTMLElement | null,
  columns: number | undefined,
): ShipMapLayout {
  const [room, setRoom] = useState(true);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.contentRect.width > 0) {
          setRoom(e.contentRect.width >= STAGE_COLUMN_MIN_WIDGET_WIDTH);
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  if (columns !== undefined && columns <= STAGE_LIST_ONLY_MAX_COLUMNS) {
    return "stages";
  }
  return room ? "both" : "diagram";
}

/**
 * The craft's staging stack as the in-game display lists it: the stage still to
 * fire at the top, each with the titles of its parts and how many of each. The
 * stage the next press of the stage control fires carries a "Next" badge, and
 * only while the stage number is a current reading. Stages already fired are
 * not listed, as in game. Used beside the Ship Map diagram.
 */
export function StageColumn({
  stages,
  fill = false,
}: {
  stages: StageEntry[];
  /** Fills the whole width of its row, with no diagram beside it. */
  fill?: boolean;
}) {
  return (
    // The column scrolls when stages outgrow the tile, and a scrolling region has to take keyboard focus to be operable.
    <section
      aria-label="Staging"
      style={fill ? COLUMN_ALONE : COLUMN}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable
      tabIndex={0}
    >
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
    </section>
  );
}

const COLUMN: CSSProperties = {
  flex: `0 0 ${STAGE_COLUMN_WIDTH}px`,
  minHeight: 0,
  overflowY: "auto",
  boxSizing: "border-box",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  borderLeft: "1px solid var(--color-border-subtle)",
  fontSize: "var(--font-size-compact)",
};

const COLUMN_ALONE: CSSProperties = { ...COLUMN, flex: 1, borderLeft: "none" };

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
