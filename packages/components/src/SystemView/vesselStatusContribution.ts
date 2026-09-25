import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import {
  type ContactPhase,
  contactPhase,
  type FleetVesselSilence,
  getLatestFleetVesselSilence,
  overdueSeconds,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";

// ---------------------------------------------------------------------------
// SystemView's `system-view.vessel-status` self-contribution: the comms-
// derived silence reckoning for the plotted vessel, as SEMANTIC data
// (severity/emphasis/label), never colours. SystemDiagram (the host) owns
// the palette; a contributor only ever says what it means, not what it
// looks like.
//
// `silence.<guid>.state` is a genuinely dynamic per-vessel topic (the guid
// is only known once `vessel.identity` resolves at RUNTIME), while a
// contribution's `deps` are declared once, statically, at module load. This
// contribution therefore depends on the static `vessel.identity` topic for
// the target id, and reads the actual reckoning through
// `getLatestFleetVesselSilence` (fleet-contact.ts's per-vessel bridge,
// mirrored there by whichever widget keeps the vessel's silence topic
// subscribed via `useFleetVesselSilence`, SystemView included): the same
// "static pointer bridges a lifetime/scope mismatch" discipline
// `getViewUt()` already uses for the view clock.
//
// The reckoning is a Processor rather than the contribution's own `compute`
// because it is a function of the view clock and of that bridge, neither of
// which is a declared dep. A contribution recomputes only when its declared
// inputs move; a Processor is evaluated every frame and notifies only when
// its answer changes, so the countdown advances, and a loss is announced, off
// the frame's own `viewUt` with nothing re-rendering while it holds still.
//
// A `label` is a plain string the host draws wherever it likes, so the
// durations below go through `writeQuantity`, the sanctioned string escape,
// rather than `<Unit>`. Both intervals are differences between universal
// times, so they are GAME seconds ("s") and ride the six-hour-day ladder, not
// the wall-clock one.
// ---------------------------------------------------------------------------

export interface SystemViewVesselStatusEntry {
  /** The vessel this entry decorates: `vessel.identity`'s `vesselId`. */
  target: string;
  severity: "info" | "warning" | "critical";
  /** Every entry from this contribution is a model's opinion, never a direct observation. */
  emphasis: "observed" | "reckoned";
  label: string;
  tooltip?: string;
}

const PHASE_SEVERITY: Record<
  Exclude<ContactPhase, "nominal">,
  SystemViewVesselStatusEntry["severity"]
> = {
  waiting: "info",
  expected: "info",
  overdue: "warning",
  lost: "critical",
};

/**
 * Pure core: given a vessel id and its silence reckoning, the entries
 * `system-view.vessel-status` contributes. Exported so a test can call it
 * directly against a plain `FleetVesselSilence` fixture without going
 * through telemetry, the per-vessel bridge, or the contribution registry at
 * all.
 */
export function computeVesselStatus(
  vesselId: string,
  silence: FleetVesselSilence | undefined,
  nowUt: number,
): readonly SystemViewVesselStatusEntry[] {
  const phase = contactPhase(silence, nowUt);
  if (!phase || phase === "nominal") return [];

  const severity = PHASE_SEVERITY[phase];
  const tooltip = silence?.deadlineBasis
    ? `Silence basis: ${silence.deadlineBasis}`
    : undefined;

  if (phase === "lost") {
    return [
      {
        target: vesselId,
        severity,
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
        severity,
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
        severity,
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
      severity,
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
