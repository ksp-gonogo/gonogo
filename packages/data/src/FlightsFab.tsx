import { Fab, HistoryIcon, useModal } from "@gonogo/ui";
import { FlightsManager } from "./FlightsManager";

/**
 * History FAB — stacked above the SerialFab. Opens the FlightsManager
 * modal. Hidden by default; reveals with the FAB cluster on hover.
 */
export function FlightsFab() {
  const { open } = useModal();

  function handleClick() {
    open(<FlightsManager />, {
      title: "Flight History",
      width: "min(1024px, 95vw)",
    });
  }

  return (
    <Fab
      bottom={144}
      onClick={handleClick}
      aria-label="Flight history"
      title="Flight history"
    >
      <HistoryIcon />
    </Fab>
  );
}
