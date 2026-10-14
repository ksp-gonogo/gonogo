import type { ComponentProps } from "@ksp-gonogo/core";
import { useTelemetry } from "@ksp-gonogo/core";
import { readingOf } from "@ksp-gonogo/sitrep-client";
import { type TinyEssential, value } from "@ksp-gonogo/sitrep-sdk";
import type { PowerSystemsConfig } from "./config";
import { netToneWithUnrated, splitCamel } from "./flow";
import {
  useCycleResourceAction,
  useLiveParts,
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
  const { net, unratedCount } = useResourceBreakdown(
    topology,
    liveByFlightId,
    resource,
  );
  if (!topology) return [{ label: "NET" }];
  if (resourcesWithFlow.length === 0) {
    return [{ label: "NET", word: "NO FLOW" }];
  }
  return [
    {
      label: `${resourceLabel(resource)} NET`,
      value: readingOf(partsReading, () => value("units/s", net)),
      // A 3-column tile has no room for a decimal beside the unit once the figure is a unit or more, held mark included.
      decimals: Math.abs(net) >= 1 ? 0 : 1,
      tone: netToneWithUnrated(net, unratedCount),
    },
  ];
}
