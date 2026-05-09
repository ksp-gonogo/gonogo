import { BellIcon, Fab, useModal } from "@gonogo/ui";
import type { AlarmDraftPrefill } from "./AlarmsModal";
import type {
  Alarm,
  AlarmFireAction,
  AlarmSnapshot,
  AlarmTrigger,
} from "./types";

/**
 * Screen-agnostic alarms FAB. Consumers pass a `useSnapshot` hook +
 * callbacks so the same button works on main (backed by
 * AlarmHostService) and station (backed by AlarmClientService).
 *
 * `useSnapshot` is a hook function (not a snapshot object) so the modal
 * can subscribe to live updates — capturing a snapshot at click time
 * caused a bug where the second alarm in a session anchored to a stale UT.
 */

export interface AlarmsFabProps {
  bottom: number;
  useSnapshot: () => AlarmSnapshot;
  onAdd: (input: {
    name: string;
    notes?: string;
    trigger: AlarmTrigger;
    onFire?: AlarmFireAction[];
  }) => void;
  onUpdate: (
    id: string,
    patch: Partial<Pick<Alarm, "name" | "notes" | "trigger" | "onFire">>,
  ) => void;
  onDelete: (id: string) => void;
  /**
   * Import the modal component directly to avoid circular-provider hoops.
   * Kept as a prop so the data/presentational split stays explicit.
   */
  ModalComponent: React.FC<{
    useSnapshot: () => AlarmSnapshot;
    onAdd: AlarmsFabProps["onAdd"];
    onUpdate: AlarmsFabProps["onUpdate"];
    onDelete: AlarmsFabProps["onDelete"];
    prefill?: AlarmDraftPrefill;
  }>;
}

export function AlarmsFab({
  bottom,
  useSnapshot,
  onAdd,
  onUpdate,
  onDelete,
  ModalComponent,
}: AlarmsFabProps) {
  const { open } = useModal();

  function handleClick() {
    open(
      <ModalComponent
        useSnapshot={useSnapshot}
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
