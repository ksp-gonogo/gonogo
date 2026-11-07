import { CORE_UPLINK_CLIENT, isAwaitingFirstSignal } from "@ksp-gonogo/core";
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
  compute: (topics) => {
    const link = topics["comms.link"];
    const comms = topics["vessel.comms"];
    /*
     * The badge says the link's readings are held. A link still awaited, or
     * confirmed empty while the vessel's readings catch up after a scene
     * load or a clock jump, says nothing about a lost link.
     */
    if (isAwaitingFirstSignal(link)) return commSignalNoSignalBadge(false);
    if (comms.state === "held" && comms.grade === "loading") {
      return commSignalNoSignalBadge(false);
    }
    return commSignalNoSignalBadge(
      link.state === "held" ||
        (comms.state === "held" && link.state !== "absent"),
    );
  },
});
