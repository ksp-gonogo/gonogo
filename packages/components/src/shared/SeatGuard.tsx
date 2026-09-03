import type { ComponentDefinition } from "@ksp-gonogo/core";
import { useSeat } from "@ksp-gonogo/core";
import type { ReactNode } from "react";
import styled from "styled-components";
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
 * It SAYS why rather than blanking, the same choice `RequiresGuard` makes: a
 * widget that silently vanishes reads as a bug, and a pushed widget that
 * silently vanishes reads as the push having failed.
 */
export function SeatGuard({ def, children }: SeatGuardProps) {
  const seat = useSeat();
  if (availableAtSeat(def, seat)) return <>{children}</>;
  const blockers = groundDomainsOf(def);
  return (
    <SeatGuard__Body role="status" aria-live="polite">
      <SeatGuard__Message>Ground instrument</SeatGuard__Message>
      <SeatGuard__Hint>
        {blockers.length > 0
          ? `Reads ${blockers.join(", ")}: not available aboard.`
          : "Not available aboard."}
      </SeatGuard__Hint>
    </SeatGuard__Body>
  );
}

const SeatGuard__Body = styled.div`
  flex: 0 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 8px 12px;
  text-align: center;
  color: var(--color-text-faint);
`;

const SeatGuard__Message = styled.span`
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const SeatGuard__Hint = styled.span`
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
`;
