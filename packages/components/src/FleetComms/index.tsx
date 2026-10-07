import { registerAugment } from "@ksp-gonogo/core";
import { ToggleButton } from "@ksp-gonogo/ui";
import { Cluster, ReadoutCaption, Tooltip } from "@ksp-gonogo/ui-kit";
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
    <Cluster justify="start" role="group" aria-label="Comms overlays">
      <ReadoutCaption>Comms overlay</ReadoutCaption>
      <Tooltip text="Draw the comm links between vessels, relays and stations on the diagram">
        <ToggleButton
          type="button"
          size="sm"
          pressed={showCommlinks}
          onClick={() => setShowCommlinks(instanceId, !showCommlinks)}
        >
          Commlinks
        </ToggleButton>
      </Tooltip>
      <Tooltip text="Draw the commands in flight along their comm path on the diagram">
        <ToggleButton
          type="button"
          size="sm"
          pressed={showCommandTraffic}
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
