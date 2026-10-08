import asparagus from "../../components/src/FuelStatus/__fixtures__/asparagus-multi-stage.json";
import type { PlaybackEmit, PlaybackScenario } from "./playbackTypes";

interface BaseStage {
  stage: number;
  dryMass: number;
  fuelMass: number;
  startMass: number;
  endMass: number;
  burnTime: number;
  dvVac: number;
  dvAsl: number;
  dvActual: number;
  twrVac: number;
  twrAsl: number;
  twrActual: number;
  thrustVac: number;
  thrustAsl: number;
  thrustActual: number;
}

interface Tank {
  current: number;
  max: number;
  active: boolean;
}

function isStageList(v: unknown): v is BaseStage[] {
  return Array.isArray(v) && v.every((s) => typeof s?.burnTime === "number");
}

function isResourceBlock(v: unknown): v is { resources: Record<string, Tank> } {
  return typeof v === "object" && v !== null && "resources" in v;
}

function stagesOf(): BaseStage[] {
  for (const e of asparagus._stream.emits) {
    if (e.channel === "dv.stages" && isStageList(e.value)) return e.value;
  }
  throw new Error("the asparagus fixture carries no dv.stages");
}

function resourcesOf(): Record<string, Tank> {
  for (const e of asparagus._stream.emits) {
    if (e.channel === "vessel.resources" && isResourceBlock(e.value)) {
      return e.value.resources;
    }
  }
  throw new Error("the asparagus fixture carries no vessel.resources");
}

export const BURN_FRAMES = 40;
/** The burn plays this share of the full burn time, so the last stage is still going at the end. */
const BURN_SHARE = 0.92;

/** How full each stage's tanks are, 1 to 0, after `elapsed` seconds of burning from the top of the stack. */
export function fillAfter(
  stages: readonly Pick<BaseStage, "stage" | "burnTime">[],
  elapsed: number,
): number[] {
  let left = elapsed;
  return stages.map((s) => {
    const spent = Math.min(left, s.burnTime);
    left -= spent;
    return 1 - spent / s.burnTime;
  });
}

function frameAt(
  stages: readonly BaseStage[],
  tanks: Record<string, Tank>,
  elapsed: number,
) {
  const fill = fillAfter(stages, elapsed);
  const fuelTotal = stages.reduce((n, s) => n + s.fuelMass, 0);
  const live = stages
    .map((s, i) => ({ s, f: fill[i] }))
    .filter(({ f }) => f > 0);
  const remaining = live.reduce((n, { s, f }) => n + s.fuelMass * f, 0);
  const share = remaining / fuelTotal;
  const lf = tanks.LiquidFuel;
  const ox = tanks.Oxidizer;

  const rows = live.map(({ s, f }) => {
    const mass = s.dryMass + s.fuelMass * f;
    const dvScale =
      Math.log(mass / s.dryMass) / Math.log(s.startMass / s.endMass);
    const twrScale = s.startMass / mass;
    const perMass = (total: number) => (total / fuelTotal) * s.fuelMass;
    return {
      ...s,
      fuelMass: s.fuelMass * f,
      startMass: mass,
      burnTime: s.burnTime * f,
      dvVac: s.dvVac * dvScale,
      dvAsl: s.dvAsl * dvScale,
      dvActual: s.dvActual * dvScale,
      twrVac: s.twrVac * twrScale,
      twrAsl: s.twrAsl * twrScale,
      twrActual: s.twrActual * twrScale,
      resources: {
        LiquidFuel: {
          current: perMass(lf.max) * f,
          max: perMass(lf.max),
          active: true,
        },
        Oxidizer: {
          current: perMass(ox.max) * f,
          max: perMass(ox.max),
          active: true,
        },
      },
    };
  });
  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    rows.reduce((n, r) => n + pick(r), 0);
  const current = rows[0]?.stage ?? 0;

  const emits: PlaybackEmit[] = [
    {
      channel: "vessel.resources",
      value: {
        resources: {
          ...tanks,
          LiquidFuel: { ...lf, current: lf.max * share },
          Oxidizer: { ...ox, current: ox.max * share },
        },
      },
    },
    { channel: "vessel.structure", value: { currentStage: current } },
    {
      channel: "dv.summary",
      value: {
        stageCount: rows.length,
        totalDvVac: sum((r) => r.dvVac),
        totalDvAsl: sum((r) => r.dvAsl),
        totalDvActual: sum((r) => r.dvActual),
        totalBurnTime: sum((r) => r.burnTime),
      },
    },
    { channel: "dv.stages", value: rows },
  ];
  return {
    emits,
    caption: `Burn T+${Math.round(elapsed)} s, stage ${current} firing, ${Math.round(sum((r) => r.dvActual))} m/s left`,
  };
}

export function fuelBurnScenario(): PlaybackScenario {
  const stages = stagesOf();
  const tanks = resourcesOf();
  const total = stages.reduce((n, s) => n + s.burnTime, 0) * BURN_SHARE;
  return {
    widgetId: "fuel-status",
    scenario: "asparagus-burn-playback",
    notes: "SYNTHETIC (model-generated, NOT captured).",
    staticEmits: [],
    frames: Array.from({ length: BURN_FRAMES + 1 }, (_, i) =>
      frameAt(stages, tanks, (total * i) / BURN_FRAMES),
    ),
    stepMs: 450,
    defaultSize: { w: 10, h: 16 },
  };
}
