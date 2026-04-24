import { BellIcon, Fab, useModal } from "@gonogo/ui";
import type { Alarm, AlarmSnapshot } from "./types";

/**
 * Screen-agnostic alarms FAB. Consumers pass the current snapshot +
 * callbacks so the same button works on main (backed by
 * AlarmHostService) and station (backed by AlarmClientService).
 */

export interface AlarmsFabProps {
  bottom: number;
  snapshot: AlarmSnapshot;
  onAdd: (input: {
    ut: number;
    name: string;
    notes?: string;
    leadSeconds?: number;
  }) => void;
  onUpdate: (
    id: string,
    patch: Partial<Pick<Alarm, "ut" | "name" | "notes" | "leadSeconds">>,
  ) => void;
  onDelete: (id: string) => void;
  /**
   * Import the modal component directly to avoid circular-provider hoops.
   * Kept as a prop so the data/presentational split stays explicit.
   */
  ModalComponent: React.FC<{
    snapshot: AlarmSnapshot;
    onAdd: AlarmsFabProps["onAdd"];
    onUpdate: AlarmsFabProps["onUpdate"];
    onDelete: AlarmsFabProps["onDelete"];
  }>;
}

export function AlarmsFab({
  bottom,
  snapshot,
  onAdd,
  onUpdate,
  onDelete,
  ModalComponent,
}: AlarmsFabProps) {
  const { open } = useModal();

  function handleClick() {
    open(
      <ModalComponent
        snapshot={snapshot}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />,
      { title: "Mission Alarms" },
    );
  }

  return (
    <Fab
      bottom={bottom}
      onClick={handleClick}
      aria-label="Mission alarms"
      title="Mission alarms"
    >
      <BellIcon />
    </Fab>
  );
}
