import { ScreenProvider, useScreen } from "@ksp-gonogo/core";
import {
  SerialDeviceProvider,
  useSerialDeviceService,
} from "@ksp-gonogo/serial";
import { Fab, LayersIcon, useModal } from "@ksp-gonogo/ui";
import { Tooltip } from "@ksp-gonogo/ui-kit";
import {
  MissionProfilesProvider,
  useMissionProfilesService,
} from "./MissionProfilesContext";
import { MissionProfilesModal } from "./MissionProfilesModal";
import type { ProfileDashboard } from "./ProfileDashboard";

export interface MissionProfilesFabProps {
  bottom?: number;
  dashboard: ProfileDashboard;
}

export function MissionProfilesFab({
  bottom = 384,
  dashboard,
}: MissionProfilesFabProps) {
  const { open, close } = useModal();
  const service = useMissionProfilesService();
  const serialService = useSerialDeviceService();
  const screen = useScreen();

  function handleClick() {
    // Modal portal renders above the service provider tree; re-wrap so hooks inside the modal content resolve the service + screen correctly.
    const id = open(
      <MissionProfilesProvider service={service}>
        <SerialDeviceProvider service={serialService}>
          <ScreenProvider value={screen}>
            <MissionProfilesModal
              dashboard={dashboard}
              onClose={() => close(id)}
            />
          </ScreenProvider>
        </SerialDeviceProvider>
      </MissionProfilesProvider>,
      { title: "Dashboard layouts" },
    );
  }

  return (
    <Tooltip text="Dashboard layouts">
      <Fab bottom={bottom} onClick={handleClick} aria-label="Dashboard layouts">
        <LayersIcon />
      </Fab>
    </Tooltip>
  );
}
