import { useTelemetry } from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import { stillTrue, value } from "@ksp-gonogo/sitrep-sdk";
import { ActionMenu, type ActionMenuItem } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";

const NO_CREW: never[] = [];
const NO_PARTS: never[] = [];

type MoveProps = Readonly<{
  /** The part whose kerbals to offer. */
  partId?: string;
  /** The one kerbal to offer. */
  kerbalName?: string;
  /** Escape, Tab, an outside press, or a move having been chosen. */
  onDismiss: () => void;
  style?: CSSProperties;
}>;

/** The move command, for a caller that keeps it mounted across the menu. */
export function useCrewMoveCommand() {
  return useCommand("vessel.crew.transfer");
}

/**
 * Where kerbals can move to, one entry per part with seats. Give `partId` for
 * everyone in a part, or `kerbalName` for one kerbal. A part with no free seat
 * is disabled with the reason as its tip, and a move that would leave the craft
 * with no control asks for a second press. It is a plain list with no route of
 * its own, so a part menu panel can mount it.
 */
export function CrewMoveList(props: MoveProps) {
  const move = useCrewMoveCommand();
  return <CrewMoveListBody {...props} move={move} />;
}

/** The list, for a caller that holds the command so its delay outlives the menu. */
export function CrewMoveListBody({
  partId,
  kerbalName,
  onDismiss,
  style,
  move,
}: MoveProps & { move: ReturnType<typeof useCrewMoveCommand> }) {
  const crew =
    stillTrue(useTelemetry("vessel.crew"), undefined)?.crew ?? NO_CREW;
  const parts =
    stillTrue(useTelemetry("vessel.parts"), undefined)?.parts ?? NO_PARTS;

  const occupied = new Map<string, number>();
  for (const member of crew) {
    if (member.partId) {
      occupied.set(member.partId, (occupied.get(member.partId) ?? 0) + 1);
    }
  }

  const sourceOf = (id: string) => parts.find((p) => p.id === id);
  const movable = crew.filter((member) => {
    if (!member.name || !member.partId) return false;
    if (kerbalName !== undefined && member.name !== kerbalName) return false;
    if (partId !== undefined && member.partId !== partId) return false;
    const seats = sourceOf(member.partId)?.seats;
    return seats != null && !seats.isExternalSeat && seats.transferAvailable;
  });

  const destinations = parts.filter(
    (part) =>
      part.seats != null &&
      !part.seats.isExternalSeat &&
      part.seats.transferAvailable,
  );

  const items: ActionMenuItem[] = movable.flatMap((member) =>
    destinations
      .filter((part) => part.id !== member.partId)
      .map((part) => {
        const name = member.name ?? "";
        const taken = value("count", occupied.get(part.id) ?? 0);
        const hasRoom = part.seats?.capacity.minus(taken).isPositive() === true;
        return {
          key: `${name}:${part.id}`,
          label: part.title,
          group: `Move ${name} to`,
          "aria-label": `Move ${name} to ${part.title}`,
          command: move.with(
            {
              kerbalName: name,
              fromPartId: member.partId ?? "",
              toPartId: part.id,
            },
            { label: `Move ${name} to ${part.title}` },
          ),
          unavailable: hasRoom ? undefined : "no free seat",
          confirmLabel: member.movesLeavingNoControl?.includes(part.id)
            ? "Move: leaves no control"
            : undefined,
        };
      }),
  );

  return (
    <ActionMenu
      items={items}
      aria-label="Move crew"
      emptyLabel="Nowhere to move to"
      onSelect={onDismiss}
      onDismiss={onDismiss}
      style={style}
    />
  );
}

/** Whether a kerbal has somewhere else aboard to move to. */
export function useCanMove(kerbalName: string): boolean {
  const crew =
    stillTrue(useTelemetry("vessel.crew"), undefined)?.crew ?? NO_CREW;
  const parts =
    stillTrue(useTelemetry("vessel.parts"), undefined)?.parts ?? NO_PARTS;
  const member = crew.find((m) => m.name === kerbalName);
  if (!member?.partId) return false;
  const source = parts.find((p) => p.id === member.partId);
  if (!source?.seats?.transferAvailable || source.seats.isExternalSeat) {
    return false;
  }
  return parts.some(
    (part) =>
      part.id !== member.partId &&
      part.seats?.transferAvailable === true &&
      !part.seats.isExternalSeat,
  );
}
