import { IconButton, InfoIcon, Tooltip } from "@ksp-gonogo/ui-kit";
import { requestSettings } from "./settingsRequest";

/**
 * A button in the screen header that opens Settings on its Help tab, where the
 * guides and the keyboard shortcuts are. Useful for reaching help without
 * going through the Settings button first. Used beside the layout history
 * controls in the header of the main screen and of a station.
 */
export function HelpButton() {
  return (
    <Tooltip text="Help and keyboard shortcuts (Ctrl/Cmd+/)">
      <IconButton
        type="button"
        aria-label="Help and keyboard shortcuts"
        aria-keyshortcuts="Control+/ Meta+/"
        onClick={() => requestSettings("help")}
      >
        <InfoIcon />
      </IconButton>
    </Tooltip>
  );
}
