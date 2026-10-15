import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { type CommsLink, type FleetVessel, hasEnded, isLinked } from "./fleet";

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
  none: number,
  unknown: number,
): { badgeLabel: string; tone: Tone } {
  if (total === 0) return { badgeLabel: "No Vessels", tone: "neutral" };
  if (none === 0 && unknown === 0)
    return { badgeLabel: "All Linked", tone: "go" };
  // A link nobody has reported is not a missing one, so it never raises the alarm tones.
  if (none === 0) return { badgeLabel: `${unknown} Unknown`, tone: "neutral" };
  if (linked === 0 && unknown === 0)
    return { badgeLabel: "No Link", tone: "nogo" };
  return { badgeLabel: `${none} Not Linked`, tone: "warn" };
}

/** Fleet-wide comms rollup for the header badge and footer meter, worded around link: the widget has no data for a health verdict. A destroyed craft still listed is not counted. */
export function commsRollup(listed: FleetVessel[]): {
  linked: number;
  none: number;
  unknown: number;
  badgeLabel: string;
  tone: Tone;
} {
  const vessels = listed.filter((v) => !hasEnded(v));
  const linked = vessels.filter((v) => isLinked(v.comms)).length;
  const none = vessels.filter((v) => v.comms === "none").length;
  const unknown = vessels.filter((v) => v.comms === "unknown").length;
  return {
    linked,
    none,
    unknown,
    ...rollupVerdict(vessels.length, linked, none, unknown),
  };
}
