import { useCallback, useEffect, useRef, useState } from "react";
import { READOUT_TRIPLE_PX } from "./AttitudeReadout";

/**
 * Measured height of what `AttitudeIndicator` puts below the dial (heading
 * strip, readout row and gaps). A column shorter than
 * `MIN_DIAL_PX + ATTITUDE_CHROME_PX` holds no dial at all.
 */
const ATTITUDE_CHROME_PX = 74;

/** The smallest dial worth drawing: a floor on whether to draw, never a size clamp. */
export const MIN_DIAL_PX = 80;

/** The gap and inset the panel puts around the control row's section, which comes back to the attitude column when the row is left out. */
const CONTROL_SECTION_SPACING_PX = 8;

/**
 * Measures the attitude column for the dial and the numeric readout.
 * `reserveThrottle` holds room for the throttle bar beside the dial, and
 * `controlSurface` caps the dial so the control surface keeps its room.
 * `controlRowWanted` says the tile is wide enough for the SAS and RCS row, and
 * `dialPossible` that nothing but room stands between the tile and a dial.
 * The row gives way when the dial fits without it and not with it, so a larger
 * tile never loses a dial a smaller one draws.
 */
export function useDialFit({
  reserveThrottle,
  controlSurface,
  controlRowWanted,
  dialPossible,
}: {
  reserveThrottle: boolean;
  controlSurface: boolean;
  controlRowWanted: boolean;
  dialPossible: boolean;
}): {
  /**
   * The largest square dial the attitude column fits on both axes: the fit
   * itself, never clamped up to {@link MIN_DIAL_PX}, so a column too small says
   * so. 180 until a ResizeObserver reports.
   */
  dialFit: number;
  /** Whether the readout's three cells fit on one line; true until a ResizeObserver reports. */
  readoutAcross: boolean;
  /** The attitude column's measured width, which the numeric readout scales its figures against; 0 until a ResizeObserver reports. */
  columnWidth: number;
  /** Whether the control row is drawn: false while it is the row that keeps the dial off the tile. */
  showControlRow: boolean;
  attachAttitude: (el: HTMLDivElement | null) => void;
  attachControlRow: (el: HTMLDivElement | null) => void;
} {
  const [dialFit, setDialFit] = useState(180);
  const [readoutAcross, setReadoutAcross] = useState(true);
  const [columnWidth, setColumnWidth] = useState(0);
  const throttleReservedRef = useRef(false);
  const controlModeRef = useRef(false);
  const [controlRowYielded, setControlRowYielded] = useState(false);
  const yieldedRef = useRef(false);
  const controlRowWantedRef = useRef(false);
  const dialPossibleRef = useRef(false);
  const controlRowPxRef = useRef(0);
  const refutedRef = useRef<{ w: number; h: number } | null>(null);
  const yieldedFromRef = useRef(0);
  const columnRef = useRef<{ w: number; h: number } | null>(null);
  const controlRowObserverRef = useRef<ResizeObserver | null>(null);
  const dialObserverRef = useRef<ResizeObserver | null>(null);
  // The ResizeObserver closure reads these refs.
  controlModeRef.current = controlSurface;
  throttleReservedRef.current = reserveThrottle;
  controlRowWantedRef.current = controlRowWanted;
  dialPossibleRef.current = dialPossible;
  /*
   * The column is measured with or without the control row, so the fit is
   * worked out both ways from the row's last measured height. The row yields
   * only when that frees a dial, and takes its place back once the dial fits
   * beside it.
   */
  const settleControlRow = useCallback(() => {
    const column = columnRef.current;
    const rowPx = controlRowPxRef.current;
    if (!controlRowWantedRef.current || !dialPossibleRef.current) {
      if (yieldedRef.current) {
        yieldedRef.current = false;
        setControlRowYielded(false);
      }
      return;
    }
    if (column !== null && rowPx > 0) {
      const across = column.w - (throttleReservedRef.current ? 42 : 0);
      const reclaim = rowPx + CONTROL_SECTION_SPACING_PX;
      const fitNow = Math.min(across, column.h - ATTITUDE_CHROME_PX);
      let yielded: boolean;
      if (yieldedRef.current) {
        const fitWithRow = Math.min(
          across,
          column.h - reclaim - ATTITUDE_CHROME_PX,
        );
        yielded = fitWithRow < MIN_DIAL_PX;
        if (fitNow < MIN_DIAL_PX) {
          /*
           * Leaving the row out did not free a dial: the column is held up by
           * the readout's own height, so the projection over-promised. The
           * row stays until the column is taller than it was then.
           */
          refutedRef.current = { w: column.w, h: yieldedFromRef.current };
          yielded = false;
        }
      } else {
        const refuted = refutedRef.current;
        const stillRefuted =
          refuted !== null && refuted.w === column.w && column.h <= refuted.h;
        if (!stillRefuted) refutedRef.current = null;
        yielded =
          !stillRefuted &&
          fitNow < MIN_DIAL_PX &&
          Math.min(across, column.h + reclaim - ATTITUDE_CHROME_PX) >=
            MIN_DIAL_PX;
        if (yielded) yieldedFromRef.current = column.h;
      }
      if (yielded !== yieldedRef.current) {
        // The measurement describes the layout before this change, so it is dropped until the column reports again.
        columnRef.current = null;
        yieldedRef.current = yielded;
        setControlRowYielded(yielded);
      }
    }
  }, []);
  // Attitude arriving, or the tile widening, can settle the row with no new measurement to carry it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the settle reads these through refs, so a change in either is the reason to run it
  useEffect(() => {
    settleControlRow();
  }, [controlRowWanted, dialPossible, settleControlRow]);
  /**
   * A callback ref on the attitude column, which renders in both branches: a
   * ref on the dial would stop observing once the fit said no, and the dial
   * could never come back. Measuring the column also keeps the verdict from
   * flip-flopping, since the readout is far shorter than a dial needs.
   */
  const attachAttitude = useCallback(
    (el: HTMLDivElement | null) => {
      dialObserverRef.current?.disconnect();
      dialObserverRef.current = null;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const w = e.contentRect.width;
          const h = e.contentRect.height;
          if (w <= 0 || h <= 0) continue;
          // Reserved by tile width, not by the column's visibility, which rides `showDial` and would make the fit oscillate.
          const throttleReserve = throttleReservedRef.current ? 42 : 0;
          const fit = Math.min(w - throttleReserve, h - ATTITUDE_CHROME_PX);
          // Capped in control mode so the control surface keeps its room; 600 is where tick text blurs.
          const cap = controlModeRef.current ? 200 : 600;
          setDialFit(Math.min(cap, Math.floor(fit)));
          columnRef.current = { w, h };
          settleControlRow();
          // The readout carries no throttle bar, so it gets the full width.
          setReadoutAcross(w >= READOUT_TRIPLE_PX);
          setColumnWidth(Math.floor(w));
        }
      });
      ro.observe(el);
      dialObserverRef.current = ro;
    },
    [settleControlRow],
  );
  /** A callback ref on the control row's own box, so its height is known while the row is drawn and remembered while it is not. */
  const attachControlRow = useCallback(
    (el: HTMLDivElement | null) => {
      controlRowObserverRef.current?.disconnect();
      controlRowObserverRef.current = null;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          if (e.contentRect.height > 0) {
            controlRowPxRef.current = Math.ceil(e.contentRect.height);
            settleControlRow();
          }
        }
      });
      ro.observe(el);
      controlRowObserverRef.current = ro;
    },
    [settleControlRow],
  );
  return {
    dialFit,
    readoutAcross,
    columnWidth,
    showControlRow: controlRowWanted && !controlRowYielded,
    attachAttitude,
    attachControlRow,
  };
}
