import { useCallback, useRef, useState } from "react";
import { READOUT_TRIPLE_PX } from "./AttitudeReadout";

/**
 * Measured height of what `AttitudeIndicator` puts below the dial (heading
 * strip, readout row and gaps). A column shorter than
 * `MIN_DIAL_PX + ATTITUDE_CHROME_PX` holds no dial at all.
 */
const ATTITUDE_CHROME_PX = 74;

/** The smallest dial worth drawing: a floor on whether to draw, never a size clamp. */
export const MIN_DIAL_PX = 80;

/**
 * Measures the attitude column for the dial and the numeric readout.
 * `reserveThrottle` holds room for the throttle bar beside the dial, and
 * `controlSurface` caps the dial so the control surface keeps its room.
 */
export function useDialFit({
  reserveThrottle,
  controlSurface,
}: {
  reserveThrottle: boolean;
  controlSurface: boolean;
}): {
  /**
   * The largest square dial the attitude column fits on both axes: the fit
   * itself, never clamped up to {@link MIN_DIAL_PX}, so a column too small says
   * so. 180 until a ResizeObserver reports.
   */
  dialFit: number;
  /** Whether the readout's three cells fit on one line; true until a ResizeObserver reports. */
  readoutAcross: boolean;
  attachAttitude: (el: HTMLDivElement | null) => void;
} {
  const [dialFit, setDialFit] = useState(180);
  const [readoutAcross, setReadoutAcross] = useState(true);
  const throttleReservedRef = useRef(false);
  const controlModeRef = useRef(false);
  const dialObserverRef = useRef<ResizeObserver | null>(null);
  // The ResizeObserver closure reads these refs.
  controlModeRef.current = controlSurface;
  throttleReservedRef.current = reserveThrottle;
  /**
   * A callback ref on the attitude column, which renders in both branches: a
   * ref on the dial would stop observing once the fit said no, and the dial
   * could never come back. Measuring the column also keeps the verdict from
   * flip-flopping, since the readout is far shorter than a dial needs.
   */
  const attachAttitude = useCallback((el: HTMLDivElement | null) => {
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
        // The readout carries no throttle bar, so it gets the full width.
        setReadoutAcross(w >= READOUT_TRIPLE_PX);
      }
    });
    ro.observe(el);
    dialObserverRef.current = ro;
  }, []);
  return { dialFit, readoutAcross, attachAttitude };
}
