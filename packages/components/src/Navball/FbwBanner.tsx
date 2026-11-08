import type { AnyBoundCommand } from "@ksp-gonogo/sitrep-sdk";
import { Button, Cluster, StatusIndicator, Tooltip } from "@ksp-gonogo/ui-kit";
import { FBW_VIEW } from "./ControlSurface";
import type { FbwState } from "./useFlyByWire";

/**
 * Fly-by-wire's state and a disarm control, drawn wherever the control surface is not, so an armed override is never live with nothing on screen to say so. Never disabled: disarming is the one action that is always safe.
 */
export function FbwBanner({
  fbwState,
  disarm,
  compact = false,
}: Readonly<{
  fbwState: FbwState;
  /** The command that disarms the override. */
  disarm: AnyBoundCommand;
  /** One toggle naming the state and disarming on a press, the hint in a tooltip, for a tile too small for the sentence. */
  compact?: boolean;
}>) {
  const view = FBW_VIEW[fbwState];
  if (compact) {
    return (
      <Tooltip text={`${view.hint}. Press to disarm`}>
        <Button size="sm" pressed={fbwState === "armed"} command={disarm}>
          {view.label}
        </Button>
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
      <Button size="sm" command={disarm}>
        Disarm FBW
      </Button>
    </Cluster>
  );
}
