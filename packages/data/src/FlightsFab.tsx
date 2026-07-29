import { useScreen } from "@ksp-gonogo/core";
import { Fab, HistoryIcon, useModal } from "@ksp-gonogo/ui";
import { FlightsManager } from "./FlightsManager";

export interface FlightsFabProps {
  /**
   * Mirrors the app-level mission-history settings: this package has no
   * access to `@ksp-gonogo/app`'s `SettingsService`, so `MainScreen` reads
   * them and passes the resolved values down. See
   * `FlightsManagerProps.missionHistoryEnabled` for the full rationale.
   */
  missionHistoryEnabled?: boolean;
  recordAllTopics?: boolean;
}

/**
 * History FAB: the lowest secondary in the FAB cluster (just above the
 * add-component button). Opens the FlightsManager modal. Hidden by
 * default; reveals with the FAB cluster on hover.
 *
 * `useScreen` is read here (FAB is mounted inside ScreenProvider) and
 * passed in as a prop because ModalProvider's portal renders above the
 * provider: so a hook called inside the modal body would fall through
 * to the default "main" and the station would still see main-only
 * controls (e.g. the Replay button).
 */
export function FlightsFab({
  missionHistoryEnabled,
  recordAllTopics,
}: FlightsFabProps = {}) {
  const { open } = useModal();
  const screen = useScreen();

  function handleClick() {
    open(
      <FlightsManager
        screen={screen}
        missionHistoryEnabled={missionHistoryEnabled}
        recordAllTopics={recordAllTopics}
      />,
      {
        title: "Flight History",
        width: "min(1024px, 95vw)",
      },
    );
  }

  return (
    <Fab
      // One rung of the cross-package FAB ladder (24, 84, 144, 204, ...): a
      // 60px pitch derived from Fab's own 40/48px height and FabRow's
      // calc(24px + env(safe-area-inset-bottom, 0px)) base. Held literal with
      // the rest of that geometry chain in @ksp-gonogo/ui, which no CSS pass
      // can see from here. Exact today; it drifts only if the base moves.
      bottom={84}
      onClick={handleClick}
      aria-label="Flight history"
      title="Flight history"
    >
      <HistoryIcon />
    </Fab>
  );
}
