import { CORE_UPLINK_CLIENT, isAwaitingFirstSignal } from "@ksp-gonogo/core";
import type { BadgeEntry } from "@ksp-gonogo/ui-kit";

/** Whether a reading is held because the connection to the game dropped. */
export function isStreamLost(reading: {
  state: string;
  grade?: string;
}): boolean {
  return reading.state === "held" && reading.grade === "disconnected";
}

/**
 * The badge for a link whose readings are held. A dropped connection to the
 * game says nothing about the craft's own link, so it reads "Stream lost" and
 * never "No signal", which belongs to a link the game stopped reporting.
 */
export function commSignalNoSignalBadge(
  noSignal: boolean,
  streamLost = false,
): BadgeEntry[] {
  if (!noSignal) return [];
  return [
    {
      id: "comm-signal-no-signal",
      label: streamLost ? "Stream lost" : "No signal",
      tone: "warn",
    },
  ];
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
      isStreamLost(link) || isStreamLost(comms),
    );
  },
});
