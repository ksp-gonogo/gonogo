import type { ComponentDefinition } from "@ksp-gonogo/core";
import { useSeat } from "@ksp-gonogo/core";
import type { ReactNode } from "react";
import { GuardPlaceholder } from "./RequiresGuard";
import { availableAtSeat, groundDomainsOf } from "./seatAvailability";

export interface SeatGuardProps {
  def: Pick<
    ComponentDefinition,
    "channels" | "optionalChannels" | "dataRequirements" | "seats"
  >;
  children: ReactNode;
}

/**
 * Refuses a ground instrument a place on the pilot's screen, and says why.
 *
 * This is a RENDER gate and not a picker filter, because a picker filter is
 * bypassed by every other path that puts an item in `items[]`: mission-profile
 * replace, scene auto-switch with no user action at all, backup restore, raw
 * localStorage, and peer widget-push, by which mission control could put a
 * space-centre widget straight onto a pilot's dashboard. The picker filter is
 * the cosmetic half of the same rule.
 *
 * It SAYS why rather than blanking, the same choice `RequiresGuard` makes and
 * in the same chrome: a widget that silently vanishes reads as a bug, and a
 * pushed widget that silently vanishes reads as the push having failed.
 */
export function SeatGuard({ def, children }: SeatGuardProps) {
  const seat = useSeat();
  if (availableAtSeat(def, seat)) return <>{children}</>;
  const blockers = groundDomainsOf(def);
  return (
    <GuardPlaceholder
      message="Ground instrument"
      hint={
        blockers.length > 0
          ? `Reads ${blockers.join(", ")}: not available aboard.`
          : "Not available aboard."
      }
    />
  );
}
