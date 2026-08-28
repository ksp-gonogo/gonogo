import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
import { VEHICLE_ASSEMBLY_SECTIONS } from "./slot";
import { VehicleSection } from "./VehicleSection";

/**
 * Every vehicle a launch complex is still integrating.
 *
 * <para>Headed UNDER INTEGRATION, which is RP-1's own word for what a launch
 * complex does to a craft file. It was BUILD LIST, and "building" is the word
 * the Space Center's own section uses for the VAB and the pads: an operator
 * reading "Construction: nothing" above a vehicle that was visibly being built
 * had two sections claiming the same word for two different things. Nothing
 * integrates a building, so the two can now be read in one column.</para>
 *
 * <para>The half of the space centre's vehicle stock that cannot fly yet. Its
 * cards carry a clock and a bar where a warehouse card carries a rollout, and
 * the only action any of them offers is a scrap, because there is nothing else
 * RP-1 will do to a vehicle that is not finished.</para>
 *
 * <para>A second contribution rather than a branch inside the first, for the
 * reason the split exists at all: two lists that answer different questions
 * should be able to be replaced, reordered or suppressed one at a time by
 * whoever hosts them.</para>
 */
export function BuildingSection() {
  const available = current(useTelemetry("rp1.available"));
  const queue = current(useTelemetry("rp1.buildQueue"));

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  return (
    <VehicleSection items={queue ?? []} title="UNDER INTEGRATION" waiting />
  );
}

registerAugment({
  id: "rp1-vehicle-assembly-building",
  augments: VEHICLE_ASSEMBLY_SECTIONS,
  component: BuildingSection,
  /** Under the warehouse; see `WarehouseSection` for why the order is declared. */
  priority: 1,
  owner: RP1,
});
