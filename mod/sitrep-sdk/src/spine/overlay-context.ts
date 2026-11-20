import { createContext, useContext } from "react";
import type { ModeId } from "../api/modes";
import { isWorldTopic } from "../delay-roles";
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
  /** Topic ids, each covering its own field paths (`vessel.flight` covers `vessel.flight.altitudeAsl`). Not consulted when `wholeCraft` is set. */
  topics: readonly string[];
  /**
   * Set when the overlay answers for the whole craft: every Topic about a
   * craft is read from it, and one it holds no value for is not known. The
   * dashboard's own Topics (see {@link isDashboardTopic}) stay the live
   * game's, and so does a Topic about the world (see {@link isWorldTopic})
   * unless the overlay holds a value of it, as a recording holds the scene
   * the flight was in.
   */
  wholeCraft?: boolean;
  /**
   * Whether a Topic is about the world, by what the running mod states, which
   * covers Uplink Topics. Absent, Gonogo's own Topics are judged from the
   * contract and every Uplink Topic counts as a craft's.
   */
  isWorld?: (topic: string) => boolean;
  client: TelemetryClient;
  store: TimelineStore;
  /** What the overlay predicts, for a heading ("Orbit insertion, rev 3"). */
  label?: string;
}

export const TelemetryOverlayContext = createContext<
  TelemetryOverlay | undefined
>(undefined);

export function useTelemetryOverlay(): TelemetryOverlay | undefined {
  return useContext(TelemetryOverlayContext);
}

const DASHBOARD_PREFIXES = ["mode.", "system.", "host.", "settings."] as const;

/**
 * Whether `topic` is the dashboard's own rather than the game's: the mode it
 * is in, the Uplinks loaded, who hosts, its settings. A mode never answers
 * these, since they are how a screen learns of the mode at all.
 */
export function isDashboardTopic(topic: string): boolean {
  return DASHBOARD_PREFIXES.some((prefix) => topic.startsWith(prefix));
}

/** Whether `overlay` answers `topic`: the Topic id itself or one of its field paths. */
export function overlayCovers(
  overlay: TelemetryOverlay | undefined,
  topic: string,
): boolean {
  if (!overlay) return false;
  const held = () =>
    overlay.topics.some((t) => topic === t || topic.startsWith(`${t}.`));
  if (!overlay.wholeCraft) return held();
  if (isDashboardTopic(topic)) return false;
  // The world stays the live game's, except where the mode states it.
  const world = overlay.isWorld ? overlay.isWorld(topic) : isWorldTopic(topic);
  return !world || held();
}
