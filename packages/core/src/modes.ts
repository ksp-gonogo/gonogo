import { useViewUt } from "@ksp-gonogo/sitrep-client";
import {
  type ModeTimeline,
  registerMode,
  stillTrue,
} from "@ksp-gonogo/sitrep-sdk";
import {
  getReplaySessionController,
  useSeat,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { useSyncExternalStore } from "react";
import { useTelemetry } from "./hooks/useTelemetry";

export {
  getModes,
  type ModeDefinition,
  type ModeId,
  type ModePlayback,
  type ModeRegistry,
  type ModeSectionProps,
  type ModeTimeline,
  type PlanStepInput,
  type PlanStepKind,
  registerMode,
  type SectionStatus,
  useModes,
} from "@ksp-gonogo/sitrep-sdk";

const REPLAY_RATES = [0.5, 1, 2, 5, 10, 50] as const;

function useScene(): string | undefined {
  return (
    stillTrue(useTelemetry("spaceCenter.scene"), undefined)?.scene ?? undefined
  );
}

/** A recorded flight's timeline while one plays back, from the replay session. */
function useRecordingTimeline(): ModeTimeline | undefined {
  const controller = getReplaySessionController();
  const snapshot = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getSnapshot(),
  );
  // Read for the re-render each frame of the replay's clock brings; the position is the controller's.
  useViewUt();
  if (!snapshot.active || !snapshot.meta) return undefined;
  return {
    start: snapshot.meta.firstFrameUt,
    end: snapshot.meta.lastFrameUt,
    at: controller.cursorUt(),
    seek: (ut) => controller.seekTo(ut),
    playback: {
      playing: snapshot.playing,
      rate: snapshot.rate,
      rates: REPLAY_RATES,
      play: () => controller.play(),
      pause: () => controller.pause(),
      setRate: (rate) => controller.setRate(rate),
      exit: () => controller.stop(),
    },
  };
}

/** Whether a recorded flight is playing back, without the per-frame re-render the Timeline needs. */
export function useReplayActive(): boolean {
  const controller = getReplaySessionController();
  const snapshot = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getSnapshot(),
  );
  return snapshot.active && snapshot.meta !== null;
}

/** Whether the vehicle editor is open at mission control. The pilot seat is never given a design, so design mode is mission control's alone. */
export function useDesignActive(): boolean {
  const seat = useSeat();
  return useScene() === "Editor" && seat === "mission-control";
}

registerMode({
  id: "design",
  name: "Design",
  order: 10,
  useActive: useDesignActive,
  // Nothing in core produces a predicted run yet; a producer registers design again with its own timeline.
  useTimeline: () => undefined,
  noTimeline: "No predicted run",
});

registerMode({
  id: "replay",
  name: "Replay",
  order: 20,
  // A recording stays in replay mode to its end, even past a scene change in it, so its Timeline can always leave it.
  useActive: useReplayActive,
  useTimeline: useRecordingTimeline,
});

/* Default is on whenever no other mode is, so it is last in order and always active. */
registerMode({
  id: "default",
  name: "Default",
  order: 1000,
  useActive: () => true,
});
