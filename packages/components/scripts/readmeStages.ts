/**
 * The stages the README pictures are drawn from: each a set of widgets placed
 * on a grid, fed from committed fixtures and playback models only.
 */
import { ascentFirstScene, ascentFrames } from "./navballAscentModel";
import type { PlaybackFrame } from "./playbackFrame";
import { tilePixels } from "./probe/payload";
import type { StageCell, StageFrame, StageSpec } from "./probe/readme-entry";

const STAGE_PADDING = 24;
const STAGE_GAP = 24;

function toStageFrames(frames: readonly PlaybackFrame[]): StageFrame[] {
  return frames.map((f) => ({ ut: f.ut, emits: f.emits }));
}

/**
 * The grid sizes the Navball is shown at, smallest to largest. Each size is the
 * first at which something new is drawn: the three figures of the tiny form at
 * 3x3, the stacked readout at 4x6 (the shortest four-column tile that holds
 * its three lines), the dial at 4x7 (the shortest four-column tile that holds
 * one), the throttle column and control row at 5x9 (the
 * shortest five-column tile that holds a dial beside them), the widget's own
 * default size, and the tall tile that has room for the full control surface.
 */
export const NAVBALL_SIZES: ReadonlyArray<{
  w: number;
  h: number;
  config?: Record<string, unknown>;
}> = [
  { w: 3, h: 3 },
  { w: 4, h: 6 },
  { w: 4, h: 7 },
  { w: 5, h: 9 },
  { w: 8, h: 11 },
  { w: 7, h: 20, config: { controlMode: true } },
];

export type NavballLayout = "row" | "stacked";

/**
 * Every Navball size on one ascent: one fixture, one track, so every instance is
 * moved to the same instant by the same step. All tiles share a top edge. The
 * `row` layout puts them side by side in order; `stacked` stands the tall
 * control tile at the end and packs the others in two columns beside it, so the
 * picture stays close to a rectangle.
 */
export function navballSizesStage(layout: NavballLayout = "row"): StageSpec {
  const first = ascentFirstScene();
  const sized = NAVBALL_SIZES.map((s) => ({ ...s, ...tilePixels(s.w, s.h) }));
  const cell = (
    s: (typeof sized)[number],
    x: number,
    y: number,
  ): StageCell => ({
    widgetId: "navball",
    fixture: first,
    w: s.w,
    h: s.h,
    config: s.config,
    x,
    y,
    track: "ascent",
  });
  const cells: StageCell[] = [];
  let right: number;
  let bottom: number;
  if (layout === "row") {
    let x = STAGE_PADDING;
    for (const s of sized) {
      cells.push(cell(s, x, STAGE_PADDING));
      x += s.pxW + STAGE_GAP;
    }
    right = x - STAGE_GAP;
    bottom = STAGE_PADDING + Math.max(...sized.map((s) => s.pxH));
  } else {
    const columns = [sized.slice(0, 3), sized.slice(3, 5)];
    let x = STAGE_PADDING;
    bottom = STAGE_PADDING;
    for (const column of columns) {
      let y = STAGE_PADDING;
      for (const s of column) {
        cells.push(cell(s, x, y));
        y += s.pxH + STAGE_GAP;
      }
      bottom = Math.max(bottom, y - STAGE_GAP);
      x += Math.max(...column.map((s) => s.pxW)) + STAGE_GAP;
    }
    const tall = sized[sized.length - 1];
    cells.push(cell(tall, x, STAGE_PADDING));
    bottom = Math.max(bottom, STAGE_PADDING + tall.pxH);
    right = x + tall.pxW;
  }
  return {
    width: right + STAGE_PADDING,
    height: bottom + STAGE_PADDING,
    cells,
    tracks: { ascent: toStageFrames(ascentFrames()) },
  };
}
