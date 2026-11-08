import { useCommand } from "@ksp-gonogo/sitrep-client";
import { CloseIcon } from "@ksp-gonogo/ui";
import { type BoundControlCommand, Button } from "@ksp-gonogo/ui-kit";
import { type FleetVessel, hasEnded } from "./fleet";

/** The command that takes a destroyed craft off this command centre's catalog. */
export type DismissVessel = (vessel: FleetVessel) => BoundControlCommand;

/** The dismissal a widget hands to every place it shows a destroyed craft, set up once in the widget's own body. */
export function useDismissEnded(): DismissVessel {
  const dismiss = useCommand("trackingStation.catalog.dismiss");
  return (vessel) =>
    dismiss.with({ vesselId: vessel.id }, { label: `Dismiss ${vessel.name}` });
}

/** Takes a destroyed craft off this command centre's catalog; draws nothing for a craft still flying, or with no dismissal to call. */
export function DismissEnded({
  vessel,
  onDismiss,
}: {
  vessel: FleetVessel;
  onDismiss?: DismissVessel;
}) {
  if (!hasEnded(vessel) || onDismiss === undefined) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      command={onDismiss(vessel)}
      aria-label={`Dismiss ${vessel.name} from the catalog`}
    >
      <CloseIcon size={12} />
    </Button>
  );
}
