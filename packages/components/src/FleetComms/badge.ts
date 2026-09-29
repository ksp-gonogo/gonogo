import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

// A contribution's `compute` sees payloads without staleness, so a Processor judges `comms.link` first.

/** `true` connected, `false` a positive report of no link, `null` unknown. */
export type CommsLinkState = boolean | null;

export const COMMS_LINK = CORE_UPLINK_CLIENT.registerProcessor({
  id: "comms-link-state",
  deps: [{ reading: "comms.link" }] as const,
  compute: ([linkReading]): CommsLinkState =>
    linkReading.state === "observed"
      ? (linkReading.value.connected ?? null)
      : null,
});

/** An unknown link still draws a badge, so it stays distinguishable from no comms at all. */
export function commsLinkBadge(link: CommsLinkState | undefined): BadgeEntry[] {
  if (link === true)
    return [{ id: "fleet-comms-link", label: "LINK", tone: "go" }];
  if (link === false)
    return [{ id: "fleet-comms-link", label: "NO LINK", tone: "nogo" }];
  return [{ id: "fleet-comms-link", label: NULL_DISPLAY, tone: "neutral" }];
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "fleet-comms-badge",
  contributes: "system-view.badges",
  deps: [COMMS_LINK],
  compute: (topics) => {
    const reading = topics[COMMS_LINK.id];
    return commsLinkBadge(
      reading?.state === "observed" || reading?.state === "held"
        ? reading.value
        : undefined,
    );
  },
});
