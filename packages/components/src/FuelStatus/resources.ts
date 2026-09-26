import { useTelemetry } from "@ksp-gonogo/core";
import { type ResourceAmountMap, useStream } from "@ksp-gonogo/sitrep-client";
import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";

/** A resource we render, with a fixed colour and a scope: `"current"` is the current stage, `"vessel"` the vessel-wide total. */
export interface ResourceDef {
  name:
    | "LiquidFuel"
    | "Oxidizer"
    | "MonoPropellant"
    | "XenonGas"
    | "ElectricCharge";
  label: string;
  color: string;
  scope: "current" | "vessel";
}

export const RESOURCES: readonly ResourceDef[] = [
  {
    name: "LiquidFuel",
    label: "Liquid Fuel",
    color: "var(--color-accent-fg)",
    scope: "current",
  },
  {
    name: "Oxidizer",
    label: "Oxidizer",
    color: "var(--color-status-info-fg)",
    scope: "current",
  },
  {
    name: "MonoPropellant",
    label: "RCS",
    color: "var(--color-status-warning-bg)",
    scope: "vessel",
  },
  {
    name: "XenonGas",
    label: "Xenon",
    color: "var(--color-tag-purple-fg)",
    scope: "vessel",
  },
  {
    name: "ElectricCharge",
    label: "Power",
    color: "var(--color-status-warning-bg)",
    scope: "vessel",
  },
] as const;

/** A resource row: which resource, and its amount and capacity as readings. */
export interface ResourceRow {
  def: ResourceDef;
  amount: Reading<Value<"units">>;
  capacity: Reading<Value<"units">>;
}

/** One resource's amount and capacity as readings, so `Meter` marks a held figure. All three reads run unconditionally, whichever scope the resource uses. */
function useResourceReading(def: ResourceDef): ResourceRow {
  const vessel = useTelemetry("vessel.resources").resources[def.name];
  const stageAmount = useStream<ResourceAmountMap>("dv.currentStageResource")[
    def.name
  ];
  const stageCapacity = useStream<ResourceAmountMap>(
    "dv.currentStageResourceMax",
  )[def.name];
  if (def.scope === "vessel") {
    return { def, amount: vessel.current, capacity: vessel.max };
  }
  return { def, amount: stageAmount, capacity: stageCapacity };
}

/** Every resource's row, in catalogue order. */
export function useResourceRows(): ResourceRow[] {
  // Rules of Hooks forbids calls in a `.map`; the RESOURCES catalogue has a fixed order so these reads are 1:1.
  const lf = useResourceReading(RESOURCES[0]);
  const ox = useResourceReading(RESOURCES[1]);
  const rcs = useResourceReading(RESOURCES[2]);
  const xe = useResourceReading(RESOURCES[3]);
  const ec = useResourceReading(RESOURCES[4]);
  return [lf, ox, rcs, xe, ec];
}

/** Whether the craft carries this resource: a reported capacity, current or held, above zero. A held tank size still says the tank is there. */
export function carries(capacity: Reading<Value<"units">>): boolean {
  if (capacity.state !== "observed" && capacity.state !== "stale") return false;
  return capacity.value?.isPositive() ?? false;
}
