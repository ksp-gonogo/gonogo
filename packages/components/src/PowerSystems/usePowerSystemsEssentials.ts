import type { ComponentProps } from "@ksp-gonogo/core";
import { useTelemetry } from "@ksp-gonogo/core";
import { readingOf } from "@ksp-gonogo/sitrep-client";
import type { TinyEssential } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { MODELLED_CAPTION } from "./ChargeTrendBox";
import { netRate } from "./chargeRate";
import { useSmoothedRate } from "./chargeTrend";
import type { PowerSystemsConfig } from "./config";
import { netToneWithUnrated, splitCamel } from "./flow";
import { useChargeOutlook } from "./useChargeOutlook";
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
  const { topology, liveByFlightId, resourcesListed, resourcesPresent } =
    useLiveParts();
  const partsReading = useTelemetry("vessel.parts");
  const { resource, pick } = useResourcePick(
    config?.defaultResource ?? "ElectricCharge",
    resourcesListed,
    resourcesPresent,
  );
  useCycleResourceAction(resourcesListed, resource, pick);
  const breakdown = useResourceBreakdown(topology, liveByFlightId, resource);
  const measured = useMeasuredCharge(resource);
  const net = measured.net ?? breakdown.net;
  const netKnown =
    !measured.unknown &&
    (breakdown.flowMeasured ||
      (resource === "ElectricCharge" && measured.net !== undefined));
  const smoothedNet = useSmoothedRate(
    resource === "ElectricCharge" && netKnown ? net : undefined,
  );
  const { trend } = useChargeOutlook({
    isCharge: resource === "ElectricCharge",
    netKnown,
    net,
    smoothedNet,
    storage: breakdown.storage,
  });
  const unratedCount = measured.net === undefined ? breakdown.unratedCount : 0;
  if (!topology) return [{ label: "NET" }];
  if (resourcesListed.length === 0) {
    return [{ label: "NET", word: "NO FLOW" }];
  }
  if (trend?.direction === "draining" && trend.atLimit && !trend.modelled) {
    return [{ label: "EC", word: "EMPTY", tone: "nogo" }];
  }
  if (measured.unknown) {
    return [{ label: `${resourceLabel(resource)} NET`, word: NULL_DISPLAY }];
  }
  const emptyIn =
    trend?.secondsToEmpty === undefined
      ? []
      : [
          {
            label: "EMPTY IN",
            value: value("s", trend.secondsToEmpty),
            tone: trend.modelled ? ("info" as const) : ("warn" as const),
            ...(trend.modelled && {
              mark: { kind: "modelled" as const, caption: MODELLED_CAPTION },
            }),
          },
        ];
  return [
    {
      label: `${resourceLabel(resource)} NET`,
      value: readingOf(partsReading, () => netRate(resource, net)),
      // A 3-column tile has no room for a decimal beside the unit once the figure is a unit or more, held mark included. Under a tenth, a second decimal keeps a small draw from reading as zero.
      decimals:
        Math.abs(net) >= 1 ? 0 : net !== 0 && Math.abs(net) < 0.1 ? 2 : 1,
      tone: netToneWithUnrated(net, unratedCount),
    },
    ...emptyIn,
  ];
}
