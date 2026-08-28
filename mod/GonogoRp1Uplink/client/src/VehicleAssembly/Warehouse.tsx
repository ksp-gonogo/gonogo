import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
import { VEHICLE_ASSEMBLY_SECTIONS } from "./slot";
import { VehicleSection } from "./VehicleSection";

/**
 * Every vehicle RP-1 has finished, whether it is standing in the warehouse or
 * out on a pad.
 *
 * <para>RP-1 holds a vehicle in the warehouse or on the build list, never both,
 * and the two answer different questions: what can fly, and what is being made.
 * Interleaved, every vehicle carried the same set of controls with only a badge
 * to say which of them could actually be pressed; split, the section a card
 * sits in already says most of that and the badge only has to carry what is
 * left.</para>
 *
 * <para><b>Contributed rather than drawn by the host.</b> Vehicle Assembly
 * mounts this through the same slot, and the same <c>registerAugment</c> call,
 * that an outside Uplink adding its own section would use. There is no private
 * path for the widget's own content, which is what makes the slot adequate by
 * construction rather than by assertion.</para>
 */
export function WarehouseSection() {
  const available = current(useTelemetry("rp1.available"));
  const warehouse = current(useTelemetry("rp1.warehouse"));

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  return (
    <VehicleSection items={warehouse ?? []} title="WAREHOUSE" waiting={false} />
  );
}

registerAugment({
  id: "rp1-vehicle-assembly-warehouse",
  augments: VEHICLE_ASSEMBLY_SECTIONS,
  component: WarehouseSection,
  // Ahead of the build list, rather than left to whichever module the bundler
  // happened to evaluate first. What can fly right now is the more urgent of
  // the two questions, and an order that depends on import order is one a
  // formatter can reverse.
  priority: 0,
  owner: RP1,
});
