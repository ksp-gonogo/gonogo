import { useScreen } from "@gonogo/core";
import { Fab, HistoryIcon, useModal } from "@gonogo/ui";
import { FlightsManager } from "./FlightsManager";

/**
 * History FAB — the lowest secondary in the FAB cluster (just above the
 * add-component button). Opens the FlightsManager modal. Hidden by
 * default; reveals with the FAB cluster on hover.
 *
 * `useScreen` is read here (FAB is mounted inside ScreenProvider) and
 * passed in as a prop because ModalProvider's portal renders above the
 * provider — so a hook called inside the modal body would fall through
 * to the default "main" and the station would still see main-only
 * controls (e.g. the Replay button).
 */
export function FlightsFab() {
  const { open } = useModal();
  const screen = useScreen();

  function handleClick() {
    open(<FlightsManager screen={screen} />, {
      title: "Flight History",
      width: "min(1024px, 95vw)",
    });
  }

  return (
    <Fab
      bottom={84}
      onClick={handleClick}
      aria-label="Flight history"
      title="Flight history"
    >
      <HistoryIcon />
    </Fab>
  );
}
