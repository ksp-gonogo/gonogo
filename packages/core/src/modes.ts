import { registerMode, stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { useModeState, useSeat } from "@ksp-gonogo/sitrep-sdk/spine";
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

function useScene(): string | undefined {
  return (
    stillTrue(useTelemetry("spaceCenter.scene"), undefined)?.scene ?? undefined
  );
}

/** Whether a recorded flight is playing back: the mode the mod says the dashboard is in. */
export function useReplayActive(): boolean {
  return useModeState()?.mode === "replay";
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
  // Design has no timeline until core produces a predicted run.
  useTimeline: () => undefined,
  noTimeline: "No predicted run",
  tone: "info",
});

/*
 * The mod says when a replay is on and holds its timeline. What is registered
 * here is how this screen presents it.
 */
registerMode({
  id: "replay",
  name: "Replay",
  order: 20,
  useActive: useReplayActive,
  tone: "go",
});

/* Live is on whenever no other mode is, so it is last in order and always active. */
registerMode({
  id: "live",
  name: "Live",
  order: 1000,
  useActive: () => true,
  tone: "go",
});
