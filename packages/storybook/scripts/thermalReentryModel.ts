import type { PlaybackEmit, PlaybackScenario } from "./playbackTypes";

interface Part {
  name: string;
  maxTemp: number;
  peak: number;
  /** When the part is hottest, 0 to 1 across the re-entry. */
  center: number;
  width: number;
}

/** A thin antenna heats first and lets go first; the shield soaks the longest. */
export const PARTS: readonly Part[] = [
  {
    name: "Communotron 16",
    maxTemp: 1200,
    peak: 0.99,
    center: 0.3,
    width: 0.16,
  },
  {
    name: "Mk1 Command Pod",
    maxTemp: 2200,
    peak: 0.91,
    center: 0.5,
    width: 0.2,
  },
  {
    name: "Heat Shield (2.5m)",
    maxTemp: 2400,
    peak: 0.985,
    center: 0.58,
    width: 0.16,
  },
];

export const REENTRY_FRAMES = 44;
const REENTRY_SECONDS = 140;
const AMBIENT_RATIO = 0.14;
const PEAK_FLUX_KW = 18750;
const ENGINE_MAX_K = 2273;

export function ratioOf(part: Part, t: number): number {
  const bell = Math.exp(-(((t - part.center) / part.width) ** 2));
  return AMBIENT_RATIO + (part.peak - AMBIENT_RATIO) * bell;
}

export function hottestAt(t: number): { part: Part; ratio: number } {
  return PARTS.map((part) => ({ part, ratio: ratioOf(part, t) })).reduce(
    (a, b) => (b.ratio > a.ratio ? b : a),
  );
}

function frameAt(t: number): { emits: PlaybackEmit[]; caption: string } {
  const { part, ratio } = hottestAt(t);
  const shield = PARTS[2];
  const flux = PEAK_FLUX_KW * Math.exp(-(((t - 0.52) / 0.19) ** 2));
  const engine = 300 + 24 * ratioOf(shield, t);
  const temp = ratio * part.maxTemp;
  const emits: PlaybackEmit[] = [
    {
      channel: "vessel.thermal",
      value: {
        maxSkinTempRatio: ratio,
        maxInternalTempRatio: ratio * 0.97,
        hottestPart: {
          internalTemp: temp * 0.97,
          maxTemp: part.maxTemp,
          skinTemp: temp,
          skinMaxTemp: part.maxTemp,
          name: part.name,
        },
        heatShieldTemp:
          300 +
          2200 *
            ((ratioOf(shield, t) - AMBIENT_RATIO) /
              (shield.peak - AMBIENT_RATIO)),
        heatShieldFlux: flux,
        hottestEngineTemp: engine,
        hottestEngineMaxTemp: ENGINE_MAX_K,
        hottestEngineTempRatio: engine / ENGINE_MAX_K,
        anyEnginesOverheating: false,
      },
    },
  ];
  return {
    emits,
    caption: `Re-entry T+${Math.round(t * REENTRY_SECONDS)} s, hottest ${part.name}`,
  };
}

export function thermalReentryScenario(): PlaybackScenario {
  return {
    widgetId: "thermal-status",
    scenario: "reentry-playback",
    notes: "SYNTHETIC (model-generated, NOT captured).",
    staticEmits: [],
    frames: Array.from({ length: REENTRY_FRAMES + 1 }, (_, i) =>
      frameAt(i / REENTRY_FRAMES),
    ),
    stepMs: 400,
    defaultSize: { w: 9, h: 14 },
  };
}
