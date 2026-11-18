import { createContext, useContext } from "react";
import type { ModeId } from "../api/modes";
import type { TelemetryClient } from "./client";
import type { TimelineStore } from "./timeline-store";

/**
 * A second stream laid over the live one for a subtree, answering only the
 * Topics it names. Every other Topic, the scene, the career and the bodies
 * among them, still comes from the live stream. A design's prediction is one:
 * it answers `vessel.flight` and the rest from its own store, and the live
 * store never holds a predicted value.
 */
export interface TelemetryOverlay {
  /** The mode whose values the overlay carries, such as `"design"` for a prediction. */
  mode: ModeId;
  /** Topic ids, each covering its own field paths (`vessel.flight` covers `vessel.flight.altitudeAsl`). */
  topics: readonly string[];
  client: TelemetryClient;
  store: TimelineStore;
  /** What the overlay predicts, for a heading ("Splashdown Demo, rev 15"). */
  label?: string;
}

export const TelemetryOverlayContext = createContext<
  TelemetryOverlay | undefined
>(undefined);

export function useTelemetryOverlay(): TelemetryOverlay | undefined {
  return useContext(TelemetryOverlayContext);
}

/** Whether `overlay` answers `topic`: the Topic id itself or one of its field paths. */
export function overlayCovers(
  overlay: TelemetryOverlay | undefined,
  topic: string,
): boolean {
  if (!overlay) return false;
  return overlay.topics.some((t) => topic === t || topic.startsWith(`${t}.`));
}
