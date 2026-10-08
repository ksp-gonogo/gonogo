import realtime from "../../components/src/WarpControl/__fixtures__/realtime-1x.json";
import type { PlaybackEmit, PlaybackScenario } from "./playbackTypes";

export const RAILS = [1, 5, 10, 50, 100, 1000, 10_000, 100_000] as const;

interface Step {
  index: number;
  paused: boolean;
}

/** Up the ladder a rung at a time, a stay at the top, back down, then a pause and a resume. */
export const STEPS: readonly Step[] = [
  ...RAILS.map((_, index) => ({ index, paused: false })),
  { index: 7, paused: false },
  { index: 7, paused: false },
  ...[6, 5, 4, 3, 2, 1, 0].map((index) => ({ index, paused: false })),
  { index: 0, paused: true },
  { index: 0, paused: true },
  { index: 0, paused: false },
];

function frameOf(step: Step) {
  const rate = RAILS[step.index];
  const emits: PlaybackEmit[] = [
    {
      channel: "time.warp",
      value: {
        warpRate: rate,
        warpRateIndex: step.index,
        warpMode: 0,
        paused: step.paused,
      },
    },
  ];
  const label = step.paused ? "paused" : `${rate} times`;
  return { emits, caption: `Warp ${label}` };
}

export function warpLadderScenario(): PlaybackScenario {
  const frames = STEPS.map(frameOf);
  const rest = realtime._stream.emits.filter((e) => e.channel !== "time.warp");
  return {
    widgetId: "warp-control",
    scenario: "warp-ladder-playback",
    notes: "SYNTHETIC (model-generated, NOT captured).",
    staticEmits: rest,
    frames,
    stepMs: 800,
    defaultSize: { w: 8, h: 8 },
  };
}
