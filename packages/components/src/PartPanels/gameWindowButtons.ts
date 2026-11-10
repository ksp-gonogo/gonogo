/**
 * A game button that opens a window on the game's screen. `module` is the
 * `PartModule` as the part's action list names it, `null` for a button on the
 * part itself, and left out where only the event name is known.
 */
interface GameWindowButton {
  module?: string | null;
  event: string;
}

/**
 * The part menu buttons known to open a game window. Listed by hand because a
 * button says nothing of what it does until it is pressed. A part panel that
 * names one of these in `replaces` takes the button instead.
 */
const GAME_WINDOW_BUTTONS: readonly GameWindowButton[] = [
  { module: null, event: "SpawnTransferDialog" },
  { module: null, event: "ShowUpgradeStats" },
  { module: null, event: "SetVesselNaming" },
  { module: "ModuleCommand", event: "RenameVessel" },
  { module: "KerbalEVA", event: "RenameVessel" },
  { module: "ModuleAsteroid", event: "RenameAsteroidEvent" },
  { module: "ModuleComet", event: "RenameCometEvent" },
  { module: "ModuleKerbNetAccess", event: "OpenKerbNet" },
  { module: "ModuleRoboticController", event: "OpenControllerEditor" },
  { module: "ModuleScienceContainer", event: "ReviewDataEvent" },
  { module: "ModuleScienceContainer", event: "TransferDataEvent" },
  { module: "ModuleScienceExperiment", event: "ReviewDataEvent" },
  { module: "ModuleScienceExperiment", event: "TransferDataEvent" },
  { event: "AntennaTargetGUI" },
  { event: "AntennaPlanningGUI" },
  { event: "PopupNameTagChanger" },
  { event: "ToggleWindow" },
  { event: "ToggleUI" },
  { event: "ShowPopup" },
  { event: "ViewImage" },
  { event: "ManualTracking" },
  { event: "BoomEvent" },
  { event: "KillEvent" },
  { event: "analyze" },
  { event: "reviewEvent" },
  { event: "GUIToggleWindow" },
];

export function opensGameWindow(module: string | null, event: string): boolean {
  return GAME_WINDOW_BUTTONS.some(
    (button) =>
      button.event === event &&
      (button.module === undefined || button.module === module),
  );
}
