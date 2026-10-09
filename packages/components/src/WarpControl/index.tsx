import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useActionInput,
  useGameContext,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand, useViewUt } from "@ksp-gonogo/sitrep-client";
import {
  observedValue,
  stillTrue,
  type TinyEssential,
} from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, writeQuantity } from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import {
  useAlarmCreator,
  useAlarmsLauncher,
  usePendingAlarms,
} from "../shared/AlarmsLauncher";
import { magnitudeOf } from "../shared/magnitude";
import { useWarpIntent } from "../shared/WarpIntent";
import type { TimeTrigger } from "../TransferWindow/config";
import { delayRequiringAlarm } from "./alarmGate";
import {
  type WarpControlActions,
  type WarpControlConfig,
  warpActions,
} from "./config";
import { WarpControlConfigForm } from "./WarpControlConfigForm";
import { WarpControlView } from "./WarpControlView";
import read from "./warp-control.declarations.g";
import { armWarpEvent, warpEventTargets } from "./warpEvents";
import { normalizeWarpMode, TOP_WARP_INDEX, warpLabel } from "./warpLevels";

export { delayRequiringAlarm } from "./alarmGate";
export type { WarpControlActions, WarpControlConfig } from "./config";

const topics = defineTopicManifest({
  channels: ["time.warp"],
  optionalChannels: read.optionalChannels,
  fields: [
    "time.warp.warpRate",
    "time.warp.warpRateIndex",
    "time.warp.warpMode",
    "time.warp.paused",
    "comms.delay.oneWaySeconds",
    "vessel.orbit.patches",
    "vessel.identity.vesselId",
    "fleet.silence.vessels",
  ],
});

/** Everything the body and the tiny form share: the warp reading, the pause and alarm gates, and the actions bound to them. */
function useWarpControl(config: WarpControlConfig | undefined) {
  // Every warp field is a discrete simulation mode that cannot drift between updates, so the last state received still holds.
  const warpReading = topics.useTelemetry("time.warp");
  const warp = stillTrue(warpReading, undefined);
  const indexRaw = warp?.warpRateIndex;
  const isPaused = warp?.paused;
  // Sim-meta controls dispatch at the meta-vantage and are never signal-delayed.
  const announceWarpIntent = useWarpIntent();
  const warpCmd = useCommand("time.setWarpIndex", { vantage: META_VANTAGE });
  const pauseCmd = useCommand("time.setPaused", { vantage: META_VANTAGE });

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
  const createAlarm = useAlarmCreator<TimeTrigger>();
  const delayReading = topics.useTelemetry("comms.delay");
  const blockingDelay = delayRequiringAlarm(stillTrue(delayReading, undefined));
  // Only in flight, and only with an alarm pipeline that could satisfy the gate.
  const alarmRequired =
    config?.requireAlarmUnderDelay !== false &&
    scene === "Flight" &&
    pending !== null &&
    pending.length === 0 &&
    blockingDelay !== null;

  const viewUt = useViewUt();
  const events = warpEventTargets({
    orbit: observedValue(topics.useTelemetry("vessel.orbit")),
    silence: stillTrue(topics.useTelemetry("fleet.silence"), undefined),
    identity: stillTrue(topics.useTelemetry("vessel.identity"), undefined),
    viewUt: viewUt?.valueOf(),
  });

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

  const armEventAction = (
    id: string,
    payload: { kind: string; value?: unknown },
  ) => {
    if (payload.kind === "button" && payload.value !== true) return undefined;
    const target = events.find((e) => e.id === id);
    if (!createAlarm || !target || !armWarpEvent(createAlarm, target)) {
      return undefined;
    }
    return { Armed: target.alarmName };
  };

  useActionInput<WarpControlActions>({
    "step-up": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      if (alarmRequired) return undefined;
      const next = Math.min(TOP_WARP_INDEX, (currentIndex ?? 0) + 1);
      setWarp(next);
      return { Warp: warpLabel(next) };
    },
    "step-down": (payload) => {
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
    "toggle-pause": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      togglePause();
      return { Paused: !effectivePaused };
    },
    "warp-to-contact": (payload) => armEventAction("contact", payload),
    "warp-to-soi": (payload) => armEventAction("soi", payload),
  });

  return {
    events,
    warp,
    scene,
    hasGameSignal,
    warpableScene,
    currentIndex,
    effectivePaused,
    alarmRequired,
    blockingDelay,
    delayReading,
    pending,
    createAlarm,
    openAlarms,
    setWarp,
    togglePause,
  };
}

/** The tiny form: the warp level, and the one button that drops it to realtime. */
function useWarpEssentials({
  config,
}: Readonly<ComponentProps<WarpControlConfig>>): readonly TinyEssential[] {
  const { warp, warpableScene, hasGameSignal, currentIndex, setWarp } =
    useWarpControl(config);
  const physics = normalizeWarpMode(warp?.warpMode) === "Physics";
  const realtime = currentIndex === 0;
  return [
    {
      label: "WARP",
      // The ladder's own label while on the high-warp ladder; physics warp has its own, so its rate is written as it is.
      word:
        warp === undefined
          ? NULL_DISPLAY
          : currentIndex !== null && !physics
            ? warpLabel(currentIndex)
            : `${writeQuantity(warp.warpRate, { decimals: 0 })}×`,
      tone: physics ? "warn" : "neutral",
    },
    {
      label: "RESET",
      control: {
        label: "▶ 1×",
        active: realtime,
        disabled: realtime || (hasGameSignal && !warpableScene),
        title: "Reset time warp to 1×",
        onPress: () => setWarp(0),
      },
    },
  ];
}

/**
 * Time-warp control: the current warp rate and a ladder of step buttons. The
 * full 8-button ladder yields to a 3-button stepper when the tile is small.
 */
function WarpControlComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<WarpControlConfig>>) {
  const {
    events,
    warp,
    scene,
    hasGameSignal,
    warpableScene,
    currentIndex,
    effectivePaused,
    alarmRequired,
    blockingDelay,
    delayReading,
    pending,
    createAlarm,
    openAlarms,
    setWarp,
    togglePause,
  } = useWarpControl(config);

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
      createAlarm={createAlarm}
      events={events}
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
    "Set KSP time warp from the dashboard. Shows the current warp rate and mode, with a button for each warp level. When the craft's one-way signal delay is over 5 seconds, warping up in flight needs an alarm set first; the tile's settings can turn this off.",
  tags: ["control", "time"],
  defaultSize: { w: 6, h: 5 },
  // Below it the ladder has no room.
  minSize: { w: 4, h: 4 },
  component: WarpControlComponent,
  tiny: {
    title: "WARP",
    bindsActions: true,
    useEssentials: useWarpEssentials,
  },
  configComponent: WarpControlConfigForm,
  channels: topics.channels,
  ...read,
  fields: topics.fields,
  // The scene and career reads only dim it; warp is a pilot's control.
  seats: ["mission-control", "pilot"],
  defaultConfig: { requireAlarmUnderDelay: true },
  actions: warpActions,
  augmentSlots: ["warp-control.stepper"],
  pushable: true,
});

export { WarpControlComponent };
