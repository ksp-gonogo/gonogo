#!/usr/bin/env node
/**
 * Topology/dv variant of the fake Sitrep replay server — a SEPARATE process
 * on a SEPARATE port from `sitrep-stream-server.mjs`, carrying the same base
 * `SNAPSHOT` PLUS `vessel.parts` / `dv.stages` / `dv.summary` /
 * `vessel.structure`.
 *
 * Those four topics are deliberately absent from the shared fixture (see
 * that file's doc comment) — other specs (power-systems.spec.ts's own
 * ORIGINAL form) asserted the resulting "Waiting for vessel topology…" /
 * title-only state, and the shared snapshot must stay exactly as it is so
 * those assertions keep meaning what they say. Real topology-tree/ΔV-stack
 * rendering coverage instead comes from THIS variant, used only by
 * power-systems.spec.ts and fuel-status.spec.ts (via `bootstrapPair`'s
 * `sitrepPort` option in helpers.ts).
 *
 * The craft below is the SAME "Mun Tester" vessel the shared snapshot
 * describes (Bob Kerman aboard, ~100km circular-ish Kerbin orbit) — a small
 * Mk1-pod stack: pod + battery + two deployed solar panels + a high-gain
 * antenna (EC producers/consumers PowerSystems renders), plus a two-tank
 * LiquidFuel/Oxidizer stack feeding an LV-909 Terrier (the propulsive
 * stage FuelStatus's ΔV/stage-stack renders). The EC storage split
 * (pod 48.802/50 + battery 400/400 = 448.802/450) and the LiquidFuel/
 * Oxidizer stage-resource split (539.797302768469/1980 and
 * 659.752174156984/2420, split evenly across the two tanks) reuse the
 * exact numbers `vessel.resources` already carries in the shared snapshot,
 * so a reader cross-checking the two fixtures sees one consistent craft
 * rather than two unrelated numbers for the "same" vessel.
 */
import { SNAPSHOT, startReplayServer } from "./sitrep-stream-server.mjs";

const PORT = Number.parseInt(
  process.env.SITREP_REPLAY_TOPOLOGY_PORT ?? "18091",
  10,
);

const payloadMeta = { source: "sitrep-stream-server-topology", quality: 0 };

function part({
  id,
  parentId,
  name,
  title,
  position,
  bounds,
  dryMass,
  inverseStage,
  maxTemp,
  category,
  modules = [],
  isRobotics = false,
  isPowerRelated = false,
  resources = {},
  moduleStates = [],
}) {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    name,
    title,
    position,
    bounds,
    dryMass,
    inverseStage,
    maxTemp,
    category,
    modules,
    isRobotics,
    isPowerRelated,
    resources,
    moduleStates,
    actionBindings: [],
  };
}

// EC storage split matches `vessel.resources.ElectricCharge` in the shared
// SNAPSHOT (448.802128027849 / 450) so the two fixtures describe one craft.
const POD_EC_CURRENT = 48.802128027849;
const POD_EC_MAX = 50;
const BATTERY_EC_CURRENT = 400;
const BATTERY_EC_MAX = 400;

// LiquidFuel/Oxidizer split evenly across the two FL-T800 tanks; totals
// match `vessel.resources` in the shared SNAPSHOT.
const LF_CURRENT_HALF = 539.797302768469 / 2;
const LF_MAX_HALF = 1980 / 2;
const OX_CURRENT_HALF = 659.752174156984 / 2;
const OX_MAX_HALF = 2420 / 2;

const VESSEL_PARTS = {
  parts: [
    part({
      id: "1",
      name: "mk1pod",
      title: "Mk1 Command Pod",
      position: { x: 0, y: 0, z: 0 },
      bounds: { size: { x: 1.25, y: 1.3, z: 1.25 } },
      dryMass: 0.8,
      inverseStage: 0,
      maxTemp: 2400,
      category: "Pod",
      modules: ["ModuleCommand"],
      resources: {
        ElectricCharge: { amount: POD_EC_CURRENT, maxAmount: POD_EC_MAX },
      },
    }),
    part({
      id: "2",
      parentId: "1",
      name: "parachuteSingle",
      title: "Mk16 Parachute",
      position: { x: 0, y: 0.7, z: 0 },
      bounds: { size: { x: 1.25, y: 0.3, z: 1.25 } },
      dryMass: 0.1,
      inverseStage: 0,
      maxTemp: 1200,
      category: "Parachute",
      modules: ["ModuleParachute"],
    }),
    part({
      id: "3",
      parentId: "1",
      name: "batteryPack",
      title: "Z-200 Battery Pack",
      position: { x: 0.2, y: -0.3, z: 0 },
      bounds: { size: { x: 0.3, y: 0.2, z: 0.3 } },
      dryMass: 0.1,
      inverseStage: 0,
      maxTemp: 2000,
      category: "Electrical",
      isPowerRelated: true,
      resources: {
        ElectricCharge: {
          amount: BATTERY_EC_CURRENT,
          maxAmount: BATTERY_EC_MAX,
        },
      },
    }),
    part({
      id: "4",
      parentId: "1",
      name: "foldingPanel1",
      title: "OX-4W 2x3 Photovoltaic Panels",
      position: { x: 0.6, y: -0.3, z: 0.2 },
      bounds: { size: { x: 0.2, y: 0.05, z: 0.6 } },
      dryMass: 0.0175,
      inverseStage: 0,
      maxTemp: 1200,
      category: "Electrical",
      isPowerRelated: true,
      resources: {
        ElectricCharge: {
          amount: 0,
          maxAmount: 0,
          flow: 4.2,
          nominalFlow: 4.2,
        },
      },
    }),
    part({
      id: "5",
      parentId: "1",
      name: "foldingPanel2",
      title: "OX-4W 2x3 Photovoltaic Panels",
      position: { x: -0.6, y: -0.3, z: 0.2 },
      bounds: { size: { x: 0.2, y: 0.05, z: 0.6 } },
      dryMass: 0.0175,
      inverseStage: 0,
      maxTemp: 1200,
      category: "Electrical",
      isPowerRelated: true,
      resources: {
        ElectricCharge: {
          amount: 0,
          maxAmount: 0,
          flow: 4.2,
          nominalFlow: 4.2,
        },
      },
    }),
    part({
      id: "6",
      parentId: "1",
      name: "HighGainAntenna5",
      title: "HG-5 High Gain Antenna",
      position: { x: 0, y: -0.3, z: 0.6 },
      bounds: { size: { x: 0.15, y: 0.15, z: 0.15 } },
      dryMass: 0.12,
      inverseStage: 0,
      maxTemp: 1200,
      category: "Communication",
      resources: {
        ElectricCharge: {
          amount: 0,
          maxAmount: 0,
          flow: -0.17,
          nominalFlow: -0.17,
        },
      },
    }),
    part({
      id: "7",
      parentId: "1",
      name: "fuelTankFlt800A",
      title: "FL-T800 Fuel Tank",
      position: { x: 0, y: -0.8, z: 0 },
      bounds: { size: { x: 1.25, y: 1.2, z: 1.25 } },
      dryMass: 0.5,
      inverseStage: 1,
      maxTemp: 2000,
      category: "FuelTank",
      resources: {
        LiquidFuel: { amount: LF_CURRENT_HALF, maxAmount: LF_MAX_HALF },
        Oxidizer: { amount: OX_CURRENT_HALF, maxAmount: OX_MAX_HALF },
      },
    }),
    part({
      id: "8",
      parentId: "7",
      name: "fuelTankFlt800B",
      title: "FL-T800 Fuel Tank",
      position: { x: 0, y: -2.0, z: 0 },
      bounds: { size: { x: 1.25, y: 1.2, z: 1.25 } },
      dryMass: 0.5,
      inverseStage: 1,
      maxTemp: 2000,
      category: "FuelTank",
      resources: {
        LiquidFuel: { amount: LF_CURRENT_HALF, maxAmount: LF_MAX_HALF },
        Oxidizer: { amount: OX_CURRENT_HALF, maxAmount: OX_MAX_HALF },
      },
    }),
    part({
      id: "9",
      parentId: "8",
      name: "liquidEngineTerrier",
      title: "LV-909 Terrier",
      position: { x: 0, y: -3.2, z: 0 },
      bounds: { size: { x: 0.9, y: 0.6, z: 0.9 } },
      dryMass: 0.5,
      inverseStage: 1,
      maxTemp: 2000,
      category: "Engine",
      modules: ["ModuleEngines"],
      moduleStates: [{ type: "ModuleEngines", state: "Off", flameout: false }],
    }),
  ],
  meta: payloadMeta,
};

// Two stages: stage 1 (propulsive — the two fuel tanks + Terrier above) is
// the CURRENT/active stage; stage 0 (pod + chute + battery + panels +
// antenna, no engine) is the final stage. `thrustVac`/TWR figures are
// derived from the shared SNAPSHOT's `vessel.propulsion` (totalMass
// 13.8299436569214 t, availableThrust 215 kN) so the two fixtures agree:
// TWRVac = 215 / (13.8299436569214 * 9.81) ≈ 1.5848.
const DV_STAGES = [
  {
    stage: 1,
    stageMass: 13.8299436569214,
    dryMass: 7.793,
    fuelMass: 6.0369436569214,
    startMass: 13.8299436569214,
    endMass: 7.793,
    burnTime: 210.4,
    deltaVVac: 1450.2,
    deltaVASL: 1120.5,
    deltaVActual: 1310.8,
    TWRVac: 1.5848,
    TWRASL: 1.2246,
    TWRActual: 1.4321,
    ispVac: 345,
    ispASL: 265,
    ispActual: 310,
    thrustVac: 215,
    thrustASL: 166.2,
    thrustActual: 195,
    resources: {
      LiquidFuel: { current: 539.797302768469, max: 1980 },
      Oxidizer: { current: 659.752174156984, max: 2420 },
    },
  },
  {
    stage: 0,
    stageMass: 7.793,
    dryMass: 7.793,
    fuelMass: 0,
    startMass: 7.793,
    endMass: 7.793,
    burnTime: 0,
    deltaVVac: 0,
    deltaVASL: 0,
    deltaVActual: 0,
    TWRVac: 0,
    TWRASL: 0,
    TWRActual: 0,
    ispVac: 0,
    ispASL: 0,
    ispActual: 0,
    thrustVac: 0,
    thrustASL: 0,
    thrustActual: 0,
    resources: {},
  },
];

const DV_SUMMARY = {
  stageCount: 2,
  totalDvVac: 1450.2,
  totalDvAsl: 1120.5,
  totalDvActual: 1310.8,
  totalBurnTime: 210.4,
};

const VESSEL_STRUCTURE = {
  currentStage: 1,
  stageCount: 2,
  partCount: VESSEL_PARTS.parts.length,
  meta: payloadMeta,
};

const EXTRA_TOPICS = {
  "vessel.parts": VESSEL_PARTS,
  "dv.stages": DV_STAGES,
  "dv.summary": DV_SUMMARY,
  "vessel.structure": VESSEL_STRUCTURE,
};

startReplayServer({ port: PORT, extraTopics: EXTRA_TOPICS });

process.stdout.write(
  `[sitrep-replay-topology] carrying ${Object.keys(SNAPSHOT).length} base topics + ${Object.keys(EXTRA_TOPICS).length} topology/dv topics\n`,
);
