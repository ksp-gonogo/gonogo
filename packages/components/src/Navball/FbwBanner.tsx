import { Button, Cluster, StatusIndicator } from "@ksp-gonogo/ui-kit";
import { FBW_VIEW } from "./ControlSurface";
import type { FbwState } from "./useFlyByWire";

/**
 * Fly-by-wire's state and a disarm control, drawn wherever the control surface is not, so an armed override is never live with nothing on screen to say so. Never disabled: disarming is the one action that is always safe.
 */
export function FbwBanner({
  fbwState,
  onDisarm,
}: Readonly<{ fbwState: FbwState; onDisarm: () => void }>) {
  const view = FBW_VIEW[fbwState];
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
