import { registerAugment } from "@ksp-gonogo/core";
import { ToggleButton } from "@ksp-gonogo/ui";
import { Cluster } from "@ksp-gonogo/ui-kit";
// The header link badge is not an augment: it is a CONTRIBUTION to
// SystemView's automatic `system-view.badges` slot. Side-effect imported so
// registering this augment set registers the badge with it.
import "./badge";
import {
  setShowCommandTraffic,
  setShowCommlinks,
  useFleetCommsToggles,
} from "./toggles";

/**
 * Fleet/Comms on `SystemView`: the Commlinks and Traffic controls, plus the
 * link-status badge its sibling `./badge` contributes.
 *
 * This deliberately draws NOTHING into the diagram, and must not: an overlay
 * fill can only work in the diagram's own coordinate space, which buys a
 * straight segment from the origin to the active vessel's dot regardless of
 * the relay topology the signal actually took. SystemView's
 * `system-view.entities` contributions answer the same three questions off the
 * real graph instead: the CommNet relay edges
 * (`vesselOrbitsContribution.ts`), the selected vessel's highlighted route
 * home (`commsPath.ts`), and the pending-command pulses riding that route
 * (`commsTraffic.ts`). A second, disagreeing answer drawn over the top of
 * those is what a duplicate pulse looks like on screen.
 *
 * The toggles stay an AUGMENT, deliberately: they add controls to the
 * diagram's action area rather than drawing over it, which is what an augment
 * is for. Their store (`./toggles`) is read by `SystemView/index.tsx`
 * directly, to gate the connection-line entities and command-traffic pulses it
 * draws.
 */
function FleetCommsActions() {
  const { showCommlinks, showCommandTraffic } = useFleetCommsToggles();
  return (
    <Cluster justify="start" gap="xs">
      <ToggleButton
        type="button"
        size="sm"
        active={showCommlinks}
        title="Show commlinks"
        onClick={() => setShowCommlinks(!showCommlinks)}
      >
        Commlinks
      </ToggleButton>
      <ToggleButton
        type="button"
        size="sm"
        active={showCommandTraffic}
        title="Show command traffic"
        onClick={() => setShowCommandTraffic(!showCommandTraffic)}
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
