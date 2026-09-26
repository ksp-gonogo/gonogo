import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useActionInput,
  useGameContext,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { usePanelDelay } from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import { useAlarmsLauncher, usePendingAlarms } from "../shared/AlarmsLauncher";
import { magnitudeOf } from "../shared/magnitude";
import { useWarpIntent } from "../shared/WarpIntent";
import { delayRequiringAlarm } from "./alarmGate";
import {
  type WarpControlActions,
  type WarpControlConfig,
  warpActions,
} from "./config";
import { WarpControlConfigForm } from "./WarpControlConfigForm";
import { WarpControlView } from "./WarpControlView";
import { normalizeWarpMode, TOP_WARP_INDEX, warpLabel } from "./warpLevels";
import "./slots";

export { delayRequiringAlarm } from "./alarmGate";
export type { WarpControlActions, WarpControlConfig } from "./config";

const topics = defineTopicManifest({
  channels: ["time.warp"],
  optionalChannels: ["comms.delay"],
  fields: [
    "time.warp.warpRate",
    "time.warp.warpRateIndex",
    "time.warp.warpMode",
    "time.warp.paused",
    "comms.delay.oneWaySeconds",
  ],
});

/**
 * Time-warp control: the current warp rate and a ladder of step buttons. The
 * full 8-button ladder yields to a 3-button stepper when the tile is small.
 */
function WarpControlComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<WarpControlConfig>>) {
  // Every warp field is a discrete simulation mode that cannot drift between updates, so the last state received still holds.
  const warpReading = topics.useTelemetry("time.warp");
  const warp = stillTrue(warpReading, undefined);
  const indexRaw = warp?.warpRateIndex;
  const isPaused = warp?.paused;
  // Sim-meta controls dispatch at the meta-vantage and are never signal-delayed.
  const announceWarpIntent = useWarpIntent();
  const warpCmd = useCommand("time.setWarpIndex", { vantage: META_VANTAGE });
  const pauseCmd = useCommand("time.setPaused", { vantage: META_VANTAGE });
  usePanelDelay(warpCmd);
  usePanelDelay(pauseCmd);

  // Optimistic pause intent, so a click before the confirming push lands still sends the right state.
  const [pauseIntent, setPauseIntent] = useState<boolean | null>(null);
  const effectivePaused = pauseIntent ?? isPaused;
  useEffect(() => {
    if (pauseIntent === null) return;
    if (isPaused === pauseIntent) setPauseIntent(null);
  }, [pauseIntent, isPaused]);

  // Warp works in Flight, SpaceCenter and TrackingStation: a wider gate than the shared `flight` requirement.
  const { scene, hasGameSignal } = useGameContext();
  const warpableScene =
    scene === "Flight" ||
    scene === "SpaceCenter" ||
    scene === "TrackingStation";

  const currentIndex =
    typeof indexRaw === "number" && Number.isFinite(indexRaw)
      ? Math.round(indexRaw)
      : null;

  const pending = usePendingAlarms();
  const openAlarms = useAlarmsLauncher();
  const delayReading = topics.useTelemetry("comms.delay");
  const blockingDelay = delayRequiringAlarm(stillTrue(delayReading, undefined));
  // Only in flight, and only with an alarm pipeline that could satisfy the gate.
  const alarmRequired =
    config?.requireAlarmUnderDelay !== false &&
    scene === "Flight" &&
    pending !== null &&
    pending.length === 0 &&
    blockingDelay !== null;

  const setWarp = (idx: number) => {
    // Announced before the command, so this screen alone skips its unscheduled-warp alert for it.
    announceWarpIntent?.();
    void warpCmd.send({ index: idx });
  };
  const togglePause = () => {
    const next = !effectivePaused;
    setPauseIntent(next);
    void pauseCmd.send({ paused: next });
  };

  useActionInput<WarpControlActions>({
    stepUp: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      if (alarmRequired) return undefined;
      const next = Math.min(TOP_WARP_INDEX, (currentIndex ?? 0) + 1);
      setWarp(next);
      return { Warp: warpLabel(next) };
    },
    stepDown: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = Math.max(0, (currentIndex ?? 0) - 1);
      setWarp(next);
      return { Warp: warpLabel(next) };
    },
    stop: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      setWarp(0);
      return { Warp: "1×" };
    },
    togglePause: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      togglePause();
      return { Paused: !effectivePaused };
    },
  });

  return (
    <WarpControlView
      cols={w ?? 6}
      rows={h ?? 5}
      scene={scene}
      dimBody={hasGameSignal && !warpableScene}
      currentRate={magnitudeOf(warp?.warpRate)}
      mode={normalizeWarpMode(warp?.warpMode)}
      currentIndex={currentIndex}
      paused={effectivePaused}
      alarmRequired={alarmRequired}
      blockingDelay={blockingDelay}
      oneWayDelay={delayReading.oneWaySeconds}
      nextAlarm={pending?.[0] ?? null}
      onSetWarp={setWarp}
      onTogglePause={togglePause}
      onOpenAlarms={() => openAlarms?.({})}
    />
  );
}

registerComponent<WarpControlConfig>({
  id: "warp-control",
  name: "Warp Control",
  description:
    "Set KSP time warp from the dashboard. Shows current warp rate and mode; button row maps to t.timeWarp[0..7].",
  tags: ["control", "time"],
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 4, h: 4 },
  component: WarpControlComponent,
  configComponent: WarpControlConfigForm,
  channels: topics.channels,
  optionalChannels: topics.optionalChannels,
  fields: topics.fields,
  defaultConfig: { requireAlarmUnderDelay: true },
  actions: warpActions,
  augmentSlots: ["warp-control.stepper"],
  pushable: true,
});

export { WarpControlComponent };
