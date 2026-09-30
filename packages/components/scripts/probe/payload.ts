/** One backfill sample: `t` is unix-ms relative to now, so negative is in the past. */
export interface ProbeSeriesSample {
  t: number;
  v: unknown;
}

export interface ProbePayload {
  widgetId: string;
  fixture: Record<string, unknown>;
  w: number;
  h: number;
  pxW: number;
  pxH: number;
  /**
   * Mount inside the dashboard's own cell: `#root` becomes the cell, with the
   * drag header across its top and the widget in the clipping wrapper below
   * it. See `renderWidgets`' `gridCell`.
   */
  gridCell?: boolean;
  config?: Record<string, unknown>;
  instanceId?: string;
  /**
   * Render under a declared install (`src/test/installProfile.ts`), by id: the
   * fixture's `_stream` block is rewritten into the wire that install would put
   * out, uplink roster included. An augment gated on an elected capability
   * renders nothing without one, so a scene about an election has no other way
   * to reach a PNG. Only bites on a fixture that HAS a `_stream` block, a flat
   * legacy fixture declares no wire to rewrite.
   */
  profile?: string;
  /**
   * Optional per-key history, emitted onto the stream before the fixture's
   * own `_stream` block so a `useDataSeries` window (a sparkline, a trace) has
   * something in it. A key is a Topic or a field path within one.
   *
   * Sample timestamps are milliseconds relative to the pinned view time, so
   * `t = 0` is the instant the widget reads and history is negative. Keep
   * them inside the widget's window (Twr 60s, KeplerPeriod 60s, and so on).
   */
  series?: Record<string, readonly ProbeSeriesSample[]>;
  /**
   * Optional synthetic clicks dispatched after the standard mount +
   * emit + settle. Unlocks interactive states that the static render
   * can't reach, modal opens, arm-then-confirm sequences, dropdown
   * pickers (LaunchDirector crew picker, etc).
   *
   * Each entry runs sequentially: the matching DOM node is clicked
   * via `dispatchEvent(MouseEvent("click"))`, then the probe waits
   * `awaitMs` (or `100` if omitted) before the next click and before
   * the final screenshot. Missing selectors throw: the driver
   * surfaces the error so brittle fixtures get caught.
   */
  clicks?: ReadonlyArray<{ selector: string; awaitMs?: number }>;
  /**
   * Optional synthetic POINTER entries, for a surface that only exists while
   * the pointer is over something: a hover tooltip, a hover-revealed control.
   *
   * Separate from `clicks` because the two reach different states and one
   * cannot stand in for the other: a click on a part of a ship diagram selects
   * it, where a pointer entering the same part opens the readout beside it. The
   * probe dispatches `pointerenter` and `pointerover` on the match, which is
   * what React's `onPointerEnter` listens for, then leaves the pointer there
   * for the screenshot. Missing selectors throw, the same as a click's.
   */
  hovers?: ReadonlyArray<{ selector: string; awaitMs?: number }>;
  /**
   * Optional synthetic keyboard focus moves, dispatched after the hovers.
   * Captures a state that keyboard focus reaches and a pointer does not: the
   * tiny tile's hover-revealed title is one, and unlike a click's dispatched
   * `MouseEvent` this calls `element.focus()` directly, which moves real DOM
   * focus (and so real `:focus` CSS) whether or not the event would count as
   * trusted. Missing selectors throw, the same as a click's.
   */
  focuses?: ReadonlyArray<{ selector: string; awaitMs?: number }>;
  /**
   * Mount the widget as the dashboard does rather than as the committed
   * baselines were drawn: the badges contributed into its `<id>.badges` slot
   * reach its panel header beside the scene's own `_badges`. Off, only
   * `_badges` reaches the header.
   */
  asDashboard?: boolean;
}

/*
 * The dashboard's grid: ROW_HEIGHT and margin mirror
 * packages/app/src/components/Dashboard/layoutNormalization.ts, and the column
 * width approximates `lg` (cols=36) at a comfortable viewport.
 */
const COL_WIDTH = 32;
const ROW_HEIGHT = 25;
const GRID_MARGIN = 8;

/** The pixel box a `w` by `h` grid tile occupies. */
export function tilePixels(w: number, h: number): { pxW: number; pxH: number } {
  return {
    pxW: w * COL_WIDTH + (w - 1) * GRID_MARGIN,
    pxH: h * ROW_HEIGHT + (h - 1) * GRID_MARGIN,
  };
}

/** The per-size part of a render: a harness `SizeMode`, or a story's args. */
export interface ProbeSize {
  w: number;
  h: number;
  config?: Record<string, unknown>;
  clicks?: ProbePayload["clicks"];
  hovers?: ProbePayload["hovers"];
  focuses?: ProbePayload["focuses"];
}

/**
 * What `renderProbe` is handed to mount one scene at one size.
 *
 * A fixture's `_series` block, keyed by Topic or field path with an array of
 * `{t, v}` samples each, is lifted into the payload so `useDataSeries`-backed
 * sparklines and trace dots render with seeded history.
 */
export function probePayload(opts: {
  widgetId: string;
  fixture: Record<string, unknown>;
  size: ProbeSize;
  profile?: string;
  gridCell?: boolean;
  asDashboard?: boolean;
}): ProbePayload {
  const { fixture, size } = opts;
  const series = (
    fixture as { _series?: Record<string, readonly ProbeSeriesSample[]> }
  )._series;
  return {
    widgetId: opts.widgetId,
    fixture,
    w: size.w,
    h: size.h,
    ...tilePixels(size.w, size.h),
    gridCell: opts.gridCell,
    config: size.config,
    series,
    clicks: size.clicks,
    hovers: size.hovers,
    focuses: size.focuses,
    profile: opts.profile,
    asDashboard: opts.asDashboard,
  };
}
