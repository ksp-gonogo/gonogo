/**
 * Live regions rendered only while they have a message, keyed by file with how
 * many each carries.
 *
 * SHRINK-ONLY. Lower or delete an entry once its regions stay mounted (a
 * `LiveRegion` held for as long as the thing it reports on is on screen); never
 * add or raise one. See `styleguide-live-region-mount.test.ts`.
 */
export const LIVE_REGION_MOUNT_DEBT: Record<string, number> = {
  "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/RoboticsConsoleView.tsx": 3,
  "packages/app/src/alarms/AlarmsModal.tsx": 4,
  "packages/app/src/components/VantageControl.tsx": 1,
  "packages/app/src/firstRun/steps/UplinkReadinessStep.tsx": 1,
  "packages/app/src/screens/PilotScreen.tsx": 1,
  "packages/app/src/settings/UplinksSettings.tsx": 1,
  "packages/components/src/ContractManager/ContractManagerView.tsx": 1,
  "packages/components/src/Experiments/index.tsx": 1,
  "packages/components/src/LaunchDirector/InFlightPanel.tsx": 1,
  "packages/components/src/LaunchDirector/LaunchDirectorView.tsx": 2,
  "packages/components/src/LibrationPoints/LibrationPointsView.tsx": 1,
  "packages/components/src/MapView/index.tsx": 1,
  "packages/components/src/Navball/ControlSurface.tsx": 1,
  "packages/components/src/PowerSystems/PowerSystemsView.tsx": 2,
  "packages/components/src/SemiMajorAxis/index.tsx": 1,
  "packages/components/src/SpaceCenterStatus/SpaceCenterStatusView.tsx": 1,
  "packages/components/src/StationConnectView/index.tsx": 1,
  "packages/components/src/Targeting/DockingHud.tsx": 1,
  "packages/components/src/TechTree/TechTreeView.tsx": 1,
  "packages/components/src/ThermalStatus/ThermalStatusView.tsx": 1,
  "packages/components/src/TransferWindow/ReachList.tsx": 1,
  "packages/serial/src/InputMappingTab.tsx": 1,
  "packages/serial/src/SerialDevicesMenu/GamepadLearnWizard.tsx": 2,
  "packages/serial/src/SerialDevicesMenu/index.tsx": 1,
  "packages/serial/src/SerialDevicesMenu/SelfDescribingAddWizard.tsx": 3,
  "packages/ui-kit/src/CommandDelay/PanelDelayRail.tsx": 1,
  "packages/ui-kit/src/ComposerBar.tsx": 1,
  "packages/ui-kit/src/TinyEssentials.tsx": 1,
};
