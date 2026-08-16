import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import {
  type ContactPhase,
  contactPhase,
  type FleetVesselSilence,
  getLatestFleetVesselSilence,
  getViewUt,
  overdueSeconds,
} from "@ksp-gonogo/sitrep-client";
import { formatDuration } from "@ksp-gonogo/ui-kit";

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
// `getViewUt()` already uses for the view clock. The aggregator re-runs
// `compute` every telemetry frame regardless of which declared dep actually
// changed, so this stays live.
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
        label: `Overdue by ${late == null ? "?" : formatDuration(late)}`,
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
        label: `Reacquire expected in ~${formatDuration(due)}`,
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

CORE_UPLINK_CLIENT.registerContribution({
  id: "system-view-vessel-silence-status",
  contributes: "system-view.vessel-status",
  deps: ["vessel.identity"],
  compute: (topics) => {
    const vesselId = topics["vessel.identity"]?.vesselId;
    if (typeof vesselId !== "string" || vesselId === "") return null;
    const nowUt = getViewUt();
    if (nowUt == null) return null;
    return computeVesselStatus(
      vesselId,
      getLatestFleetVesselSilence(vesselId),
      nowUt,
    );
  },
});
