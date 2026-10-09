import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { BadgeEntry } from "@ksp-gonogo/ui-kit";

export function commSignalNoSignalBadge(noSignal: boolean): BadgeEntry[] {
  return noSignal
    ? [{ id: "comm-signal-no-signal", label: "No signal", tone: "warn" }]
    : [];
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "comm-signal-no-signal-badge",
  contributes: "comm-signal.badges",
  deps: ["comms.link", "vessel.comms"],
  // The badge is the statement that the link's readings are held, so it is drawn from their currency and never marked held itself.
  compute: (topics) =>
    commSignalNoSignalBadge(
      topics["comms.link"].state === "held" ||
        topics["vessel.comms"].state === "held",
    ),
});
