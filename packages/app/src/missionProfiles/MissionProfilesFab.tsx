import { ScreenProvider, useScreen } from "@ksp-gonogo/core";
import { Fab, LayersIcon, useModal } from "@ksp-gonogo/ui";
import { Tooltip } from "@ksp-gonogo/ui-kit";
import type { Layout } from "react-grid-layout";
import type { DashboardItem } from "../components/Dashboard";
import {
  MissionProfilesProvider,
  useMissionProfilesService,
} from "./MissionProfilesContext";
import { MissionProfilesModal } from "./MissionProfilesModal";
import type { MissionProfile } from "./MissionProfilesService";

export interface MissionProfilesFabProps {
  bottom?: number;
  currentItems: DashboardItem[];
  currentLayout: Layout;
  onLoad: (profile: MissionProfile) => void;
}

export function MissionProfilesFab({
  bottom = 384,
  currentItems,
  currentLayout,
  onLoad,
}: MissionProfilesFabProps) {
  const { open, close } = useModal();
  const service = useMissionProfilesService();
  const screen = useScreen();

  function handleClick() {
    // Modal portal renders above the service provider tree; re-wrap so hooks inside the modal content resolve the service + screen correctly.
    const id = open(
      <MissionProfilesProvider service={service}>
        <ScreenProvider value={screen}>
          <MissionProfilesModal
            currentItems={currentItems}
            currentLayout={currentLayout}
            onLoad={(profile) => {
              onLoad(profile);
              close(id);
            }}
            onClose={() => close(id)}
          />
        </ScreenProvider>
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
