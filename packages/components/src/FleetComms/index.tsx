import { registerAugment } from "@ksp-gonogo/core";
import { ToggleButton } from "@ksp-gonogo/ui";
import { Cluster, Tooltip } from "@ksp-gonogo/ui-kit";
// Side-effect import: the header link badge is a contribution registered alongside this augment.
import "./badge";
import {
  setShowCommandTraffic,
  setShowCommlinks,
  useFleetCommsInstanceId,
  useFleetCommsToggles,
} from "./toggles";

/**
 * The Commlinks and Traffic toggles on `SystemView`. It draws nothing into the
 * diagram: SystemView reads the toggles' store, and its `system-view.entities`
 * contributions draw the comms graph.
 */
function FleetCommsActions() {
  const instanceId = useFleetCommsInstanceId();
  const { showCommlinks, showCommandTraffic } = useFleetCommsToggles();
  return (
    <Cluster justify="start">
      <Tooltip text="Show commlinks">
        <ToggleButton
          type="button"
          size="sm"
          active={showCommlinks}
          onClick={() => setShowCommlinks(instanceId, !showCommlinks)}
        >
          Commlinks
        </ToggleButton>
      </Tooltip>
      <Tooltip text="Show command traffic">
        <ToggleButton
          type="button"
          size="sm"
          active={showCommandTraffic}
          onClick={() => setShowCommandTraffic(instanceId, !showCommandTraffic)}
        >
          Traffic
        </ToggleButton>
      </Tooltip>
    </Cluster>
  );
}

registerAugment({
  id: "fleet-comms-actions",
  augments: "system-view.actions",
  component: FleetCommsActions,
});

export { FleetCommsActions };
