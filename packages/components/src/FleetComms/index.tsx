import { registerAugment } from "@ksp-gonogo/core";
import { ToggleButton } from "@ksp-gonogo/ui";
import { Cluster } from "@ksp-gonogo/ui-kit";
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
      <ToggleButton
        type="button"
        size="sm"
        active={showCommlinks}
        title="Show commlinks"
        onClick={() => setShowCommlinks(instanceId, !showCommlinks)}
      >
        Commlinks
      </ToggleButton>
      <ToggleButton
        type="button"
        size="sm"
        active={showCommandTraffic}
        title="Show command traffic"
        onClick={() => setShowCommandTraffic(instanceId, !showCommandTraffic)}
      >
        Traffic
      </ToggleButton>
    </Cluster>
  );
}

registerAugment({
  id: "fleet-comms-actions",
  augments: "system-view.actions",
  component: FleetCommsActions,
});

export { FleetCommsActions };
