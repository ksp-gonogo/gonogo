import {
  Button,
  Cluster,
  StatusIndicator,
  ToggleButton,
  Tooltip,
} from "@ksp-gonogo/ui-kit";
import { FBW_VIEW } from "./ControlSurface";
import type { FbwState } from "./useFlyByWire";

/**
 * Fly-by-wire's state and a disarm control, drawn wherever the control surface is not, so an armed override is never live with nothing on screen to say so. Never disabled: disarming is the one action that is always safe.
 */
export function FbwBanner({
  fbwState,
  onDisarm,
  compact = false,
}: Readonly<{
  fbwState: FbwState;
  onDisarm: () => void;
  /** One toggle naming the state and disarming on a press, the hint in a tooltip, for a tile too small for the sentence. */
  compact?: boolean;
}>) {
  const view = FBW_VIEW[fbwState];
  if (compact) {
    return (
      <Tooltip text={`${view.hint}. Press to disarm`}>
        <ToggleButton
          type="button"
          size="sm"
          pressed={fbwState === "armed"}
          onClick={onDisarm}
        >
          {view.label}
        </ToggleButton>
      </Tooltip>
    );
  }
  return (
    <Cluster justify="start" wrap>
      <StatusIndicator tone="warn">
        <span role="status" aria-live="polite">
          {view.label}
        </span>{" "}
        ({view.hint.toLowerCase()})
      </StatusIndicator>
      <Button type="button" size="sm" onClick={onDisarm}>
        Disarm FBW
      </Button>
    </Cluster>
  );
}
