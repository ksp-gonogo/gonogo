import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { PlanStepKind } from "@ksp-gonogo/sitrep-sdk";

/*
 * Rule-of-thumb Δv needs, in m/s, for the stock system's common goals: the
 * community Δv map's figures for a 80 km Kerbin orbit and transfers and
 * landings from there. A prediction's measured cost replaces them once a run
 * has flown the step.
 */
const ORBIT_DV: Record<string, number> = {
  Kerbin: 3_400,
  Mun: 580,
  Minmus: 180,
};
const TRANSFER_DV: Record<string, number> = {
  Mun: 860,
  Minmus: 930,
  Duna: 1_060,
  Eve: 1_030,
};
const LAND_DV: Record<string, number> = { Mun: 890, Minmus: 340, Kerbin: 0 };

const str = (v: number | string | undefined) =>
  typeof v === "string" ? v : undefined;

const CORE_KINDS: readonly PlanStepKind[] = [
  {
    id: "launch",
    name: "Launch",
    inputs: {
      heading: { label: "Heading", unit: "°", default: 90 },
      clearAltitude: { label: "Until", unit: "km", default: 10_000 },
    },
  },
  {
    id: "reach-orbit",
    name: "Reach orbit",
    inputs: {
      body: { label: "Body", default: "Kerbin" },
      periapsis: { label: "Periapsis", unit: "km", default: 80_000 },
    },
    needsDv: (inputs) => ORBIT_DV[str(inputs.body) ?? ""],
  },
  {
    id: "transfer",
    name: "Transfer",
    inputs: {
      to: { label: "To", default: "Mun" },
      arrivalPeriapsis: {
        label: "Arrival periapsis",
        unit: "km",
        default: 15_000,
      },
    },
    needsDv: (inputs) => TRANSFER_DV[str(inputs.to) ?? ""],
  },
  {
    id: "land",
    name: "Land",
    inputs: { on: { label: "On", default: "Mun" } },
    needsDv: (inputs) => LAND_DV[str(inputs.on) ?? ""],
  },
];

CORE_UPLINK_CLIENT.registerContribution({
  id: "flight-plan-core-steps",
  contributes: "flight-plan.steps",
  compute: () => CORE_KINDS,
});
