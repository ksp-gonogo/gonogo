import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  registerComponent,
  useActionInput,
  useGameContext,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand, useViewUt } from "@ksp-gonogo/sitrep-client";
import { type CommsDelay, stillTrue, value } from "@ksp-gonogo/sitrep-sdk";
import { DimmedOverlay, ToggleButton } from "@ksp-gonogo/ui";
import {
  BellIcon,
  Button,
  Cluster,
  ConfigForm,
  Countdown,
  Field,
  FieldHint,
  NULL_DISPLAY,
  Panel,
  PauseIcon,
  PlayIcon,
  ReadoutCaption,
  Section,
  Switch,
  Truncate,
  Unit,
  useModalSaveBar,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useState } from "react";
/* `WarpButton` needs a `:focus-visible` ring, which inline style cannot express. */
import styled from "styled-components";
import {
  type PendingAlarmSummary,
  useAlarmsLauncher,
  usePendingAlarms,
} from "../shared/AlarmsLauncher";
import { magnitudeOf } from "../shared/magnitude";
import { useWarpIntent } from "../shared/WarpIntent";

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

interface WarpControlConfig {
  /**
   * Hold warp at its current rate or below, in flight, while the craft is more
   * than {@link ALARM_REQUIRED_ABOVE_SECONDS} from its command and no alarm is
   * set. Absent reads as on.
   */
  requireAlarmUnderDelay?: boolean;
}

/** The command's one-way delay to the craft above which warping up needs an alarm set, seconds. */
const ALARM_REQUIRED_ABOVE_SECONDS = 5;

/**
 * Whether the command's delay to the craft is high enough that warping up
 * needs an alarm set: `"delay"` above the threshold, `"no-path"` for a craft
 * with no path home, null otherwise.
 *
 * No path is the far end of the same condition, and a delay that has not
 * arrived answers null: not knowing the delay is not the delay being high.
 */
export function delayRequiringAlarm(
  delay: Pick<CommsDelay, "oneWaySeconds"> | undefined,
): "delay" | "no-path" | null {
  if (delay === undefined) return null;
  const oneWay = delay.oneWaySeconds;
  if (oneWay === null) return "no-path";
  if (oneWay === undefined || !oneWay.isFinite()) return null;
  return oneWay.greaterThan(value("s", ALARM_REQUIRED_ABOVE_SECONDS))
    ? "delay"
    : null;
}

// Both slots are plain composition points, so each passes empty props.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    // An Uplink contributes a warp-target action alongside the widget's own warp buttons.
    "warp-control.stepper": Record<string, never>;
  }
}

const warpActions = [
  {
    id: "stepUp",
    label: "Warp up",
    accepts: ["button"],
    description: "Step warp up one level.",
  },
  {
    id: "stepDown",
    label: "Warp down",
    accepts: ["button"],
    description: "Step warp down one level.",
  },
  {
    id: "stop",
    label: "Drop to 1×",
    accepts: ["button"],
    description: "Drop warp straight to realtime.",
  },
  {
    id: "togglePause",
    label: "Toggle pause",
    accepts: ["button"],
    description: "Pause / unpause KSP (in-flight only).",
  },
] as const satisfies readonly ActionDefinition[];

export type WarpControlActions = typeof warpActions;

/**
 * KSP HIGH-warp ladder: labels match the in-game tooltip, indices are what
 * `time.setWarpIndex` takes. Physics warp uses a different ladder and is not
 * surfaced.
 */
const HIGH_LEVELS: ReadonlyArray<{ index: number; label: string }> = [
  { index: 0, label: "1×" },
  { index: 1, label: "5×" },
  { index: 2, label: "10×" },
  { index: 3, label: "50×" },
  { index: 4, label: "100×" },
  { index: 5, label: "1k×" },
  { index: 6, label: "10k×" },
  { index: 7, label: "100k×" },
];

function WarpControlComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<WarpControlConfig>>) {
  /*
   * Every warp field is a discrete simulation mode that cannot drift between
   * updates, so the last state received still holds. Withholding the index would
   * be worse than dating it: the stepper would render 1x pressed, a positive claim
   * of realtime.
   */
  const warpReading = topics.useTelemetry("time.warp");
  const warp = stillTrue(warpReading, undefined);
  const rate = warp?.warpRate;
  const indexRaw = warp?.warpRateIndex;
  const mode = normalizeWarpMode(warp?.warpMode);
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
  const dimBody = hasGameSignal && !warpableScene;

  const currentIndex =
    typeof indexRaw === "number" && Number.isFinite(indexRaw)
      ? Math.round(indexRaw)
      : null;
  const currentRate = magnitudeOf(rate);

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
  const nextAlarm = pending?.[0] ?? null;

  const setWarp = (idx: number) => {
    /*
     * Announced before the command so the watcher knows of it when the warp state
     * changes. It suppresses only this screen's unscheduled-warp alert; every other
     * screen still sees the warp.
     */
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
      const next = Math.min(HIGH_LEVELS.length - 1, (currentIndex ?? 0) + 1);
      setWarp(next);
      return { Warp: HIGH_LEVELS[next]?.label ?? `${next}` };
    },
    stepDown: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = Math.max(0, (currentIndex ?? 0) - 1);
      setWarp(next);
      return { Warp: HIGH_LEVELS[next]?.label ?? `${next}` };
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

  // Content-priority decisions only: auto-fit handles whether the ladder ends up 8x1, 4x2 or 2x4.
  const cols = w ?? 6;
  const rows = h ?? 5;
  const showFullLadder = cols * rows >= 20 && cols >= 4 && rows >= 3;
  const showStepper = !showFullLadder && cols >= 3 && rows >= 3;
  const showModeCaption = rows >= 4;

  const rateLabel = formatRate(currentRate);
  // Physics warp keeps aerodynamics live and is risky in atmosphere, so it gets its own tint.
  const rateTone: "physics" | "high" = mode?.toLowerCase().startsWith("phys")
    ? "physics"
    : "high";
  const idx = currentIndex ?? 0;
  const downIdx = Math.max(0, idx - 1);
  const upIdx = Math.min(HIGH_LEVELS.length - 1, idx + 1);

  return (
    <Panel
      panelTitle="WARP"
      fitToSize
      sections={
        <Section full>
          <DimmedOverlay
            show={dimBody}
            message="No active save"
            hint="Time warp works in flight, Space Center, and Tracking Station."
          >
            <div style={BODY_STYLE}>
              <div style={rateStyle(rateTone)}>
                <span
                  style={RATE_VALUE_STYLE}
                  role="img"
                  aria-label={`Time warp rate ${rateLabel}`}
                >
                  {rateLabel}
                </span>
                {showModeCaption && mode !== null && mode !== "" && (
                  <ReadoutCaption>{mode}</ReadoutCaption>
                )}
              </div>

              {/* Hidden at small grid counts so the warp buttons keep their own line. */}
              {scene === "Flight" && cols >= 4 && rows >= 4 && (
                <ToggleButton
                  active={effectivePaused === true}
                  tone="warn"
                  size="sm"
                  onClick={togglePause}
                  aria-label={
                    effectivePaused === true ? "Resume game" : "Pause game"
                  }
                  title={
                    effectivePaused === true
                      ? "Resume (t.unpause)"
                      : "Pause (t.pause)"
                  }
                >
                  {effectivePaused === true ? (
                    <PlayIcon size={12} />
                  ) : (
                    <PauseIcon size={12} />
                  )}
                </ToggleButton>
              )}

              {showFullLadder && (
                // biome-ignore lint/a11y/useSemanticElements: <fieldset> names itself from <legend> and groups form controls; these are grid buttons and it would need UA resets
                <div
                  style={FULL_LADDER_STYLE}
                  role="group"
                  aria-label="Time warp levels"
                >
                  {HIGH_LEVELS.map((lvl) => {
                    const active = currentIndex === lvl.index;
                    return (
                      <WarpButton
                        key={lvl.index}
                        type="button"
                        $active={active}
                        aria-pressed={active}
                        disabled={alarmRequired && lvl.index > idx}
                        onClick={() => setWarp(lvl.index)}
                      >
                        {lvl.label}
                      </WarpButton>
                    );
                  })}
                </div>
              )}

              {showStepper && (
                // biome-ignore lint/a11y/useSemanticElements: <fieldset> names itself from <legend> and groups form controls; these are grid buttons and it would need UA resets
                <div
                  style={STEP_LADDER_STYLE}
                  role="group"
                  aria-label="Time warp controls"
                >
                  <WarpButton
                    type="button"
                    $active={false}
                    disabled={idx === 0}
                    onClick={() => setWarp(downIdx)}
                    aria-label="Warp down"
                  >
                    −
                  </WarpButton>
                  <WarpButton
                    type="button"
                    $active={idx === 0}
                    aria-pressed={idx === 0}
                    onClick={() => setWarp(0)}
                    aria-label="Drop to realtime"
                  >
                    1×
                  </WarpButton>
                  <WarpButton
                    type="button"
                    $active={false}
                    disabled={alarmRequired || idx === HIGH_LEVELS.length - 1}
                    onClick={() => setWarp(upIdx)}
                    aria-label="Warp up"
                  >
                    +
                  </WarpButton>
                </div>
              )}

              <AugmentSlot name="warp-control.stepper" props={{}} />

              {alarmRequired ? (
                <Cluster justify="center" wrap style={FOOT_ROW_STYLE}>
                  <Button type="button" onClick={() => openAlarms?.({})}>
                    Set alarm to warp
                  </Button>
                  <ReadoutCaption>
                    {blockingDelay === "no-path" ? (
                      "No path"
                    ) : (
                      <>
                        <Unit value={delayReading.oneWaySeconds} /> delay
                      </>
                    )}
                  </ReadoutCaption>
                </Cluster>
              ) : (
                nextAlarm !== null && <NextAlarm alarm={nextAlarm} />
              )}
            </div>
          </DimmedOverlay>
        </Section>
      }
    />
  );
}

/** The soonest alarm yet to fire, the thing that ends a warp without anyone touching it. */
function NextAlarm({ alarm }: Readonly<{ alarm: PendingAlarmSummary }>) {
  const viewUt = useViewUt();
  const remaining =
    alarm.ut === null || viewUt === undefined
      ? null
      : value("ut", alarm.ut).minus(viewUt);
  return (
    <Cluster
      justify="center"
      wrap
      style={FOOT_ROW_STYLE}
      aria-label="Next alarm"
    >
      <Cluster justify="center">
        <BellIcon size={12} aria-hidden="true" />
        <Truncate style={ALARM_NAME_STYLE}>{alarm.name}</Truncate>
      </Cluster>
      {remaining !== null && (
        <ReadoutCaption>
          <Countdown value={remaining} clock />
        </ReadoutCaption>
      )}
    </Cluster>
  );
}

function WarpControlConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<WarpControlConfig>>) {
  const [requireAlarm, setRequireAlarm] = useState(
    config?.requireAlarmUnderDelay !== false,
  );
  const candidate = useMemo<WarpControlConfig>(
    () => ({ requireAlarmUnderDelay: requireAlarm }),
    [requireAlarm],
  );
  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });
  return (
    <ConfigForm>
      <Field>
        <Switch
          checked={requireAlarm}
          onChange={setRequireAlarm}
          label="Require an alarm to warp under delay"
        />
        <FieldHint>
          Above <Unit value={value("s", ALARM_REQUIRED_ABOVE_SECONDS)} /> to
          command
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

/**
 * Maps the numeric `warpMode` (0 High, 1 Low, 2 Unknown) to the caption text.
 * Low is surfaced as "Physics"; Unknown or absent gives no caption and the
 * high tone.
 */
function normalizeWarpMode(raw: number | undefined): string | null {
  if (raw === 0) return "High";
  if (raw === 1) return "Physics";
  return null;
}

function formatRate(rate: number | null): string {
  if (rate === null) return NULL_DISPLAY;
  if (rate < 1.0001) return "1×";
  if (rate >= 1000) return `${(rate / 1000).toFixed(rate >= 10_000 ? 0 : 1)}k×`;
  if (Number.isInteger(rate)) return `${rate}×`;
  return `${rate.toFixed(2)}×`;
}

const BODY_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 0,
} as const;

/**
 * Physics warp tints amber: at speed in atmosphere the operator needs to know
 * it is not on-rails.
 */
function rateStyle(tone: "physics" | "high") {
  return {
    flex: "1 1 70px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--gap-related)",
    minWidth: 0,
    color:
      tone === "physics"
        ? "var(--color-status-warning-bg)"
        : "var(--color-status-go-fg)",
  } as const;
}

/* Off the type scale, which stops at --font-size-lg: this is a display-tier readout. */
const RATE_VALUE_STYLE = {
  fontSize: "24px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  lineHeight: "var(--line-height-flush)",
} as const;

/* minWidth 0 lets the grid shrink below its 8-button min-content instead of clipping. */
const FULL_LADDER_STYLE = {
  flex: "2 1 140px",
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(40px, 1fr))",
  gap: "var(--gap-related)",
  alignContent: "center",
} as const;

const STEP_LADDER_STYLE = {
  flex: "1 1 100px",
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(28px, 1fr))",
  gap: "var(--gap-related)",
  alignContent: "center",
} as const;

/* A row of its own under the controls, however wide the body is. */
const FOOT_ROW_STYLE = {
  flex: "1 1 100%",
  minWidth: 0,
} as const;

/* Sized to the name rather than filling the row, so the countdown sits beside it. */
const ALARM_NAME_STYLE = {
  flex: "0 1 auto",
  fontSize: "var(--font-size-sm)",
} as const;

const WarpButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) =>
    $active ? "var(--color-status-go-bg)" : "var(--color-surface-raised)"};
  color: var(--color-status-go-fg);
  border: 1px solid
    ${({ $active }) =>
      $active ? "var(--color-status-go-bg)" : "var(--color-border-subtle)"};
  border-radius: var(--radius-regular);
  padding: var(--inset-warp-button);
  font-size: var(--font-size-compact);
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
  letter-spacing: 0.04em;
  cursor: pointer;
  min-width: 0;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

registerComponent<WarpControlConfig>({
  id: "warp-control",
  name: "Warp Control",
  description:
    "Set KSP time warp from the dashboard. Shows current warp rate and mode; button row maps to t.timeWarp[0..7].",
  tags: ["control", "time"],
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 4, h: 4 },
  component: WarpControlComponent,
  configComponent: WarpControlConfigComponent,
  channels: topics.channels,
  optionalChannels: topics.optionalChannels,
  fields: topics.fields,
  defaultConfig: { requireAlarmUnderDelay: true },
  actions: warpActions,
  augmentSlots: ["warp-control.stepper"],
  pushable: true,
});

export { WarpControlComponent };
