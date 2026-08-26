import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

// ---------------------------------------------------------------------------
// The comms link pill in SystemView's header, as a CONTRIBUTION to the
// widget's automatic `system-view.badges` slot rather than an augment. A
// `registerAugment` into a hand-declared AugmentSlot costs a whole React
// component plus a slot declaration to say "a label and a tone in the header",
// the exact shape the framework-universal badges segment already carries for
// every widget for free.
//
// Registered on `CORE_UPLINK_CLIENT` rather than an Uplink handle, like
// `CrewStatus/badge.ts` and `ShipMap/partMetersContribution.ts`: FleetComms is
// the built-in half, no Uplink involved.
//
// ## Why a Processor sits in front of the topic read
//
// A contribution's `compute` is handed `point.payload` for a Topic dep: the
// VALUE channel alone, with no staleness. This badge's whole point is that
// silence is evidence about a LINK in a way it is not about an altitude, so a
// stale `comms.link` has to read as UNKNOWN rather than as its last value,
// which a bare payload dep cannot express. A Processor CAN take a
// `{ reading: ... }` dep, so the observed-vs-stale judgement happens there and
// the contribution consumes the already-judged answer. That reading-dep form is
// documented on `ReadingDep` in the sdk, which spells out the same failure it
// exists to prevent: deriving on last-contact values and presenting the result
// as though it were now.
// ---------------------------------------------------------------------------

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
 * The header pill for a link state.
 *
 * The unknown arm still produces a badge, carrying the shared null glyph:
 * "we do not know" is a state an operator needs to see in the header, and
 * dropping the pill would make an unknown link indistinguishable from a
 * dashboard with no comms at all. `undefined` lands here too, which is what
 * the aggregation hands for a Processor it has not evaluated yet.
 *
 * Tones fold onto the same severities the augment's `Badge` asked for
 * directly: `go` -> nominal, `nogo` -> critical, `neutral` -> none.
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
  compute: (topics) =>
    commsLinkBadge(topics[COMMS_LINK.id] as CommsLinkState | undefined),
});
