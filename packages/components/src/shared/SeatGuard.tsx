import type { ComponentDefinition } from "@ksp-gonogo/core";
import { useSeat } from "@ksp-gonogo/core";
import type { ReactNode } from "react";
import { GuardPlaceholder } from "./RequiresGuard";
import { availableAtSeat, groundDomainsOf } from "./seatAvailability";

export interface SeatGuardProps {
  def: Pick<
    ComponentDefinition,
    "name" | "channels" | "optionalChannels" | "dataRequirements" | "seats"
  >;
  children: ReactNode;
}

/**
 * Refuses a ground instrument a place on the pilot's screen, and says why. A
 * render gate, not a picker filter, because profiles, restores and peer pushes
 * all place widgets without the picker.
 */
export function SeatGuard({ def, children }: SeatGuardProps) {
  const seat = useSeat();
  if (availableAtSeat(def, seat)) return <>{children}</>;
  const blockers = groundDomainsOf(def);
  return (
    <GuardPlaceholder
      title={def.name}
      message="Ground instrument"
      hint={
        blockers.length > 0
          ? `Reads ${blockers.join(", ")}: not available aboard.`
          : "Not available aboard."
      }
    />
  );
}
