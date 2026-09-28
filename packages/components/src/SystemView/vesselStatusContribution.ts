import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import {
  type ContactPhase,
  contactPhase,
  type FleetVesselSilence,
  getLatestFleetVesselSilence,
  overdueSeconds,
} from "@ksp-gonogo/sitrep-client";
import { type AlertTone, value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";

/*
 * The `system-view.vessel-status` self-contribution: the plotted vessel's silence reckoning as a tone, emphasis and label, never colours.
 *
 * `silence.<guid>.state` is dynamic while `deps` are static, so this depends on `vessel.identity` and reads the reckoning through the `getLatestFleetVesselSilence` bridge. It is a Processor because it moves with the view clock and that bridge, neither a declared dep; it is evaluated every frame and notifies only on change.
 *
 * Labels are plain strings, so durations go through `writeQuantity`; they are differences of universal times, so GAME seconds on the six-hour-day ladder.
 */

export interface SystemViewVesselStatusEntry {
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
};

/** Pure core: the entries contributed for a vessel id and its silence reckoning, exported for direct testing. */
export function computeVesselStatus(
  vesselId: string,
  silence: FleetVesselSilence | undefined,
  nowUt: number,
): readonly SystemViewVesselStatusEntry[] {
  const phase = contactPhase(silence, nowUt);
  if (!phase || phase === "nominal") return [];

  const tone = PHASE_TONE[phase];
  const tooltip = silence?.deadlineBasis
    ? `Silence basis: ${silence.deadlineBasis}`
    : undefined;

  if (phase === "lost") {
    return [
      {
        target: vesselId,
        tone,
        emphasis: "reckoned",
        label: "Officially lost",
        tooltip,
      },
    ];
  }
  if (phase === "overdue") {
    const late = overdueSeconds(silence, nowUt);
    return [
      {
        target: vesselId,
        tone,
        emphasis: "reckoned",
        label: `Overdue by ${late == null ? "?" : writeQuantity(value("s", late))}`,
        tooltip,
      },
    ];
  }
  if (phase === "expected") {
    const predicted = silence?.predictedReacquisitionUt ?? nowUt;
    const due = Math.max(0, predicted - nowUt);
    return [
      {
        target: vesselId,
        tone,
        emphasis: "reckoned",
        label: `Reacquire expected in ~${writeQuantity(value("s", due))}`,
        tooltip,
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
      tooltip,
    },
  ];
}

const VESSEL_CONTACT_STATUS = CORE_UPLINK_CLIENT.registerProcessor({
  id: "system-view-vessel-contact-status",
  deps: ["vessel.identity"] as const,
  compute: ([identity], { viewUt }) => {
    const vesselId = identity?.vesselId;
    if (typeof vesselId !== "string" || vesselId === "") return null;
    return computeVesselStatus(
      vesselId,
      getLatestFleetVesselSilence(vesselId),
      viewUt,
    );
  },
});

CORE_UPLINK_CLIENT.registerContribution({
  id: "system-view-vessel-silence-status",
  contributes: "system-view.vessel-status",
  deps: [VESSEL_CONTACT_STATUS],
  compute: (topics) => topics[VESSEL_CONTACT_STATUS.id] ?? null,
});
