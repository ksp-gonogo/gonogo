import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import {
  type ContactPhase,
  contactPhase,
  expectedReturnUt,
  overdueSeconds,
} from "@ksp-gonogo/sitrep-client";
import {
  type AlertTone,
  CatalogEnd,
  type CatalogEntry,
  RosterPlaceSource,
  stillTrue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";

/*
 * The `tracking-station.vessel-status` self-contribution: the centre's contact with the plotted vessel, from its catalog entry, as a tone, emphasis and label, never colours.
 *
 * It is a Processor because a silent craft goes overdue on the view clock, which is not a declared dep; it is evaluated every frame and notifies only on change.
 *
 * Labels are plain strings, so durations go through `writeQuantity`; they are differences of universal times, so GAME seconds on the six-hour-day ladder.
 */

export interface TrackingStationVesselStatusEntry {
  /** The vessel this entry decorates: `vessel.identity`'s `vesselId`. */
  target: string;
  tone: AlertTone;
  /** Every entry from this contribution is a model's opinion, never a direct observation. */
  emphasis: "observed" | "reckoned";
  label: string;
  tooltip?: string;
}

const PHASE_TONE: Record<Exclude<ContactPhase, "nominal">, AlertTone> = {
  waiting: "info",
  expected: "info",
  overdue: "warn",
  lost: "nogo",
  gone: "nogo",
};

/** What the centre knows of its contact with a craft, as its catalog entry carries it. */
export type VesselContactEntry = Pick<
  CatalogEntry,
  "contact" | "expectedReturnUt" | "overdueAfterUt" | "endSource" | "endKind"
>;

/** Pure core: the entries contributed for a vessel id and the centre's contact with it, exported for direct testing. */
export function computeVesselStatus(
  vesselId: string,
  entry: VesselContactEntry | undefined,
  nowUt: number,
): readonly TrackingStationVesselStatusEntry[] {
  const phase = contactPhase(entry, nowUt);
  if (!phase || phase === "nominal") return [];

  const tone = PHASE_TONE[phase];

  if (phase === "gone") {
    return [
      {
        target: vesselId,
        tone,
        emphasis: "reckoned",
        label:
          entry?.endKind === CatalogEnd.Terminated
            ? "Terminated"
            : entry?.endSource === RosterPlaceSource.Seen
              ? "Seen destroyed"
              : "Destroyed",
      },
    ];
  }

  if (phase === "lost") {
    return [
      {
        target: vesselId,
        tone,
        emphasis: "reckoned",
        label: "Officially lost",
      },
    ];
  }
  if (phase === "overdue") {
    const late = overdueSeconds(entry, nowUt);
    return [
      {
        target: vesselId,
        tone,
        emphasis: "reckoned",
        label: `Overdue by ${late == null ? "?" : writeQuantity(value("s", late))}`,
      },
    ];
  }
  if (phase === "expected") {
    const expected = expectedReturnUt(entry) ?? nowUt;
    const due = Math.max(0, expected - nowUt);
    return [
      {
        target: vesselId,
        tone,
        emphasis: "reckoned",
        label: `Reacquire expected in ~${writeQuantity(value("s", due))}`,
      },
    ];
  }
  // waiting: silent, with no prediction to count down to.
  return [
    {
      target: vesselId,
      tone,
      emphasis: "reckoned",
      label: "No contact",
    },
  ];
}

const VESSEL_CONTACT_STATUS = CORE_UPLINK_CLIENT.registerProcessor({
  id: "tracking-station-vessel-contact-status",
  deps: [
    { reading: "vessel.identity" },
    { reading: "trackingStation.catalog" },
  ] as const,
  compute: ([identityReading, catalogReading], { viewUt }) => {
    // Which vessel is plotted is a fact until the operator switches, so a held identity still names it.
    const vesselId = stillTrue(identityReading, null)?.vesselId;
    if (typeof vesselId !== "string" || vesselId === "") return null;
    // A held catalog is the last the centre knew, and a craft's contact is still what it was then.
    const entry = stillTrue(catalogReading, null)?.entries.find(
      (e) => e.vesselId === vesselId,
    );
    return computeVesselStatus(vesselId, entry, viewUt);
  },
});

CORE_UPLINK_CLIENT.registerContribution({
  id: "tracking-station-vessel-silence-status",
  contributes: "tracking-station.vessel-status",
  deps: [VESSEL_CONTACT_STATUS],
  // Every entry is a judgement of how stale contact is, so it is drawn as reckoned rather than marked held.
  compute: (topics) => {
    const status = topics[VESSEL_CONTACT_STATUS.id];
    return status?.state === "observed" || status?.state === "held"
      ? status.value
      : null;
  },
});
