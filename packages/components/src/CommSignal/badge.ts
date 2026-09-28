import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { BadgeEntry } from "@ksp-gonogo/ui-kit";

const COMM_SIGNAL_HELD = CORE_UPLINK_CLIENT.registerProcessor({
  id: "comm-signal-held",
  deps: [{ reading: "comms.link" }, { reading: "vessel.comms" }] as const,
  compute: ([linkReading, commsReading]): boolean =>
    linkReading.state === "stale" || commsReading.state === "stale",
});

export function commSignalNoSignalBadge(noSignal: boolean): BadgeEntry[] {
  return noSignal
    ? [{ id: "comm-signal-no-signal", label: "No signal", tone: "warn" }]
    : [];
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "comm-signal-no-signal-badge",
  contributes: "comm-signal.badges",
  deps: [COMM_SIGNAL_HELD],
  // A held flag is the last thing the link said about itself, so a stale answer still counts.
  compute: (topics) => {
    const reading = topics[COMM_SIGNAL_HELD.id];
    return commSignalNoSignalBadge(
      (reading?.state === "observed" || reading?.state === "stale"
        ? reading.value
        : undefined) ?? false,
    );
  },
});
