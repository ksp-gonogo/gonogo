import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { type CommsLink, type FleetVessel, isLinked } from "./fleet";

export type Tone = "go" | "info" | "warn" | "nogo" | "neutral";

/** A tone drawn as text or a chip's edge on the panel. `info` reads the `-fg` token: the info `-bg` token is near-black. */
export const TONE_TEXT: Record<Tone, string> = {
  go: "var(--color-go-text)",
  info: "var(--color-info-mark)",
  warn: "var(--color-warn-mark)",
  nogo: "var(--color-nogo-mark)",
  neutral: "var(--color-text-muted)",
};

/** A tone drawn as a lone mark, where green takes its mark token rather than its text one. */
export const TONE_MARK: Record<Tone, string> = {
  ...TONE_TEXT,
  go: "var(--color-go-mark)",
};

/** Comms tier to tone, the only per-row signal the roster has a real read for. */
export const COMMS_TONE: Record<CommsLink, Tone> = {
  connected: "go",
  relay: "info",
  none: "nogo",
  unknown: "neutral",
};

/** Compact comms label and a full accessible name. */
export const COMMS: Record<CommsLink, { label: string; aria: string }> = {
  connected: { label: "DIRECT", aria: "Direct link" },
  relay: { label: "RELAY", aria: "Relay link" },
  none: { label: "NONE", aria: "No link" },
  unknown: { label: NULL_DISPLAY, aria: "Link state unknown" },
};

function rollupVerdict(
  total: number,
  linked: number,
  notLinked: number,
): { badgeLabel: string; tone: Tone } {
  if (total === 0) return { badgeLabel: "No Vessels", tone: "neutral" };
  if (notLinked === 0) return { badgeLabel: "All Linked", tone: "go" };
  if (linked === 0) return { badgeLabel: "No Link", tone: "nogo" };
  return { badgeLabel: `${notLinked} Not Linked`, tone: "warn" };
}

/** Fleet-wide comms rollup for the header badge and footer meter, worded around LINK: the widget has no data for a health verdict. */
export function commsRollup(vessels: FleetVessel[]): {
  linked: number;
  none: number;
  unknown: number;
  badgeLabel: string;
  tone: Tone;
} {
  const linked = vessels.filter((v) => isLinked(v.comms)).length;
  const none = vessels.filter((v) => v.comms === "none").length;
  const unknown = vessels.filter((v) => v.comms === "unknown").length;
  return {
    linked,
    none,
    unknown,
    ...rollupVerdict(vessels.length, linked, none + unknown),
  };
}
