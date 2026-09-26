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
 * Fleet/Comms on `SystemView`: the Commlinks and Traffic toggles. It draws
 * NOTHING into the diagram: SystemView's `system-view.entities` contributions
 * draw relay edges, the route home and pending-command pulses off the real
 * graph, and a second answer over them would disagree. `SystemView` reads the
 * toggles' store directly.
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
