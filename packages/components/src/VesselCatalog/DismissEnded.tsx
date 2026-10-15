import { useCommand } from "@ksp-gonogo/sitrep-client";
import { CloseIcon } from "@ksp-gonogo/ui";
import { Button } from "@ksp-gonogo/ui-kit";
import { type FleetVessel, hasEnded } from "./fleet";

/** Takes a destroyed craft off this command centre's catalog; draws nothing for a craft still flying. */
export function DismissEnded({ vessel }: { vessel: FleetVessel }) {
  const dismiss = useCommand("trackingStation.catalog.dismiss");
  if (!hasEnded(vessel)) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() =>
        void dismiss.send(
          { vesselId: vessel.id },
          { label: `Dismiss ${vessel.name}` },
        )
      }
      aria-label={`Dismiss ${vessel.name} from the catalog`}
    >
      <CloseIcon size={12} />
    </Button>
  );
}
