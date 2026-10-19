import type { ComponentProps } from "@ksp-gonogo/core";
import { useTelemetry } from "@ksp-gonogo/core";
import { readingOf } from "@ksp-gonogo/sitrep-client";
import type { TinyEssential } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { netRate } from "./chargeRate";
import type { PowerSystemsConfig } from "./config";
import { netToneWithUnrated, splitCamel } from "./flow";
import {
  useCycleResourceAction,
  useLiveParts,
  useMeasuredCharge,
  useResourceBreakdown,
  useResourcePick,
} from "./usePowerFlow";

/** The resource's short name for a tiny label: electric charge is the one an operator reads by its initials. */
function resourceLabel(resource: string): string {
  return resource === "ElectricCharge" ? "EC" : splitCamel(resource);
}

/**
 * The net rate of the picked resource, toned by whether it is a surplus or a
 * deficit: what the vessel is making less what it is using, which is the one
 * figure that says whether the power holds. The next-resource action stays
 * bound, so a key still steps the figure through the resources that flow.
 */
export function usePowerSystemsEssentials({
  config,
}: Readonly<ComponentProps<PowerSystemsConfig>>): readonly TinyEssential[] {
  const { topology, liveByFlightId, resourcesWithFlow, resourcesPresent } =
    useLiveParts();
  const partsReading = useTelemetry("vessel.parts");
  const { resource, pick } = useResourcePick(
    config?.defaultResource ?? "ElectricCharge",
    resourcesWithFlow,
    resourcesPresent,
  );
  useCycleResourceAction(resourcesWithFlow, resource, pick);
  const breakdown = useResourceBreakdown(topology, liveByFlightId, resource);
  const measured = useMeasuredCharge(resource);
  const net = measured.net ?? breakdown.net;
  const unratedCount = measured.net === undefined ? breakdown.unratedCount : 0;
  if (!topology) return [{ label: "NET" }];
  if (resourcesWithFlow.length === 0) {
    return [{ label: "NET", word: "NO FLOW" }];
  }
  if (measured.unknown) {
    return [{ label: `${resourceLabel(resource)} NET`, word: NULL_DISPLAY }];
  }
  return [
    {
      label: `${resourceLabel(resource)} NET`,
      value: readingOf(partsReading, () => netRate(resource, net)),
      // A 3-column tile has no room for a decimal beside the unit once the figure is a unit or more, held mark included. Under a tenth, a second decimal keeps a small draw from reading as zero.
      decimals:
        Math.abs(net) >= 1 ? 0 : net !== 0 && Math.abs(net) < 0.1 ? 2 : 1,
      tone: netToneWithUnrated(net, unratedCount),
    },
  ];
}
