import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { CommsLink, TopicCurrency } from "@ksp-gonogo/sitrep-sdk";
import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

/**
 * `true` connected, `false` a positive report of no link, `null` unknown, and
 * `"awaiting"` while the link's first word is still on its way: the first
 * light-time of a session, which says nothing about the link either way.
 */
export type CommsLinkState = boolean | "awaiting" | null;

/** What `comms.link`'s reading says about the link; a held reading's last word, which the badge then marks held. */
export function commsLinkState(link: TopicCurrency<CommsLink>): CommsLinkState {
  if (link.state === "observed" || link.state === "held")
    return link.value.connected ?? null;
  // A topic that arrived saying it has nothing is an answer, so only one not yet heard from is awaited.
  return link.state === "pending" ? "awaiting" : null;
}

/** An unknown link still draws a badge, so it stays distinguishable from no comms at all. */
export function commsLinkBadge(link: CommsLinkState | undefined): BadgeEntry[] {
  if (link === true)
    return [{ id: "fleet-comms-link", label: "COMMS LINKED", tone: "go" }];
  if (link === false)
    return [{ id: "fleet-comms-link", label: "NO COMMS LINK", tone: "nogo" }];
  if (link === "awaiting")
    return [
      { id: "fleet-comms-link", label: "COMMS AWAITING", tone: "neutral" },
    ];
  return [
    { id: "fleet-comms-link", label: `COMMS ${NULL_DISPLAY}`, tone: "neutral" },
  ];
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "fleet-comms-badge",
  contributes: "system-view.badges",
  deps: ["comms.link"],
  compute: (topics) =>
    commsLinkBadge(commsLinkState(topics["comms.link"])).map((badge) => ({
      ...badge,
      held: topics["comms.link"],
    })),
});
