import {
  contactPhase,
  expectedReturnUt,
  overdueSeconds,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Badge, Unit } from "@ksp-gonogo/ui-kit";
import type { ReactElement } from "react";
import type { FleetContact } from "./fleet";

/**
 * A vessel's contact state: due back, late, or given up on.
 * `overdue` is not an early `lost`: the craft is late, not gone. A silent craft with no prediction reads "no contact" and is never overdue.
 * Only going overdue (polite) and a declared loss (assertive) are announced; the per-tick countdown states are not.
 */
export function FleetContactCell({
  contact,
  vesselName,
}: {
  contact: FleetContact;
  vesselName: string;
}) {
  return useContactBadge(contact, vesselName);
}

/** The badge {@link FleetContactCell} draws, or null while it draws nothing, for a caller that lays out a line only when there is a badge to put on it. */
export function useContactBadge(
  contact: FleetContact,
  vesselName: string,
): ReactElement | null {
  const nowUt = useViewUt();
  if (nowUt == null) return null;
  const phase = contactPhase(contact, nowUt.magnitude);
  if (phase === "nominal" || phase === "gone" || phase === undefined) {
    return null;
  }

  if (phase === "lost") {
    return (
      <Badge size="sm" tone="nogo" role="alert" aria-live="assertive">
        <span style={{ textDecoration: "line-through" }}>{vesselName}</span>{" "}
        lost
      </Badge>
    );
  }

  if (phase === "overdue") {
    const late = overdueSeconds(contact, nowUt.magnitude);
    return (
      <Badge size="sm" tone="warn" live>
        {/* Game-time seconds (both terms are UT), so "s" rather than "irl:s". */}
        overdue by <Unit value={late == null ? null : value("s", late)} />
      </Badge>
    );
  }

  if (phase === "expected") {
    // No predicted instant means no interval to count down, not an interval of zero length that happens to render the same.
    const expected = expectedReturnUt(contact);
    const due =
      expected == null ? 0 : value("ut", expected).minus(nowUt).magnitude;
    return (
      <Badge size="sm" tone="info">
        reacquire in ~<Unit value={value("s", Math.max(0, due))} />
      </Badge>
    );
  }

  // waiting: silent, with no prediction to count down to.
  return (
    <Badge size="sm" tone="offline">
      no contact
    </Badge>
  );
}
