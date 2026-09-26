import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

/*
 * The comms link pill in SystemView's header, a contribution to its
 * `system-view.badges` slot. A Processor sits in front of the topic read because
 * a contribution's `compute` sees payloads without staleness, and silence is
 * evidence about a link: a stale `comms.link` must read as UNKNOWN.
 */

/**
 * The link state this badge speaks: `true` connected, `false` a positive
 * report of no link, `null` an honest unknown (nothing ever delivered, or the
 * topic has gone stale and its last value no longer stands for now).
 */
export type CommsLinkState = boolean | null;

/**
 * `comms.link` reduced to {@link CommsLinkState}. Only an `observed` reading
 * counts: on every other arm the last known link state is not evidence about
 * the link now.
 */
export const COMMS_LINK = CORE_UPLINK_CLIENT.registerProcessor({
  id: "comms-link-state",
  deps: [{ reading: "comms.link" }] as const,
  compute: ([linkReading]): CommsLinkState =>
    linkReading.state === "observed"
      ? (linkReading.value.connected ?? null)
      : null,
});

/**
 * The header pill for a link state. The unknown arm still produces a badge
 * with the null glyph, so an unknown link is distinguishable from no comms at
 * all; `undefined` (a Processor not yet evaluated) lands there too.
 */
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
  // Both value-bearing arms: the processor already judged, and a held answer is the `null` that reads as UNKNOWN.
  compute: (topics) => {
    const reading = topics[COMMS_LINK.id];
    return commsLinkBadge(
      reading?.state === "observed" || reading?.state === "stale"
        ? reading.value
        : undefined,
    );
  },
});
