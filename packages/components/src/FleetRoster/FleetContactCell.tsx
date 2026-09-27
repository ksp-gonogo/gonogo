import {
  contactPhase,
  overdueSeconds,
  useFleetVesselSilence,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Badge, Unit } from "@ksp-gonogo/ui-kit";

/**
 * A vessel's contact state: due back, late, or given up on.
 * `overdue` is not an early `lost`: the craft is late, not gone. A silent craft with no prediction reads "no contact" and is never overdue.
 * Only going overdue (polite) and a declared loss (assertive) are announced; the per-tick countdown states are not.
 */
export function FleetContactCell({
  guid,
  vesselName,
}: {
  guid: string;
  vesselName: string;
}) {
  const silence = useFleetVesselSilence(guid);
  const nowUt = useViewUt();
  const phase = contactPhase(silence, nowUt?.magnitude ?? 0);

  if (!silence || nowUt == null || phase === "nominal" || phase === undefined) {
    return null;
  }

  if (phase === "lost") {
    return (
      <Badge severity="critical" role="alert" aria-live="assertive">
        <span style={{ textDecoration: "line-through" }}>{vesselName}</span>{" "}
        lost
      </Badge>
    );
  }

  if (phase === "overdue") {
    const late = overdueSeconds(silence, nowUt.magnitude);
    return (
      <Badge severity="warning" live>
        {/* Game-time seconds (both terms are UT), so "s" rather than "irl:s". */}
        overdue by <Unit value={late == null ? null : value("s", late)} />
      </Badge>
    );
  }

  if (phase === "expected") {
    // No predicted instant means no interval to count down, not an interval of zero length that happens to render the same.
    const due =
      silence.predictedReacquisitionUt == null
        ? 0
        : value("ut", silence.predictedReacquisitionUt).minus(nowUt).magnitude;
    return (
      <Badge severity="info">
        reacquire in ~<Unit value={value("s", Math.max(0, due))} />
      </Badge>
    );
  }

  // waiting: silent, with no prediction to count down to.
  return <Badge severity="offline">no contact</Badge>;
}
