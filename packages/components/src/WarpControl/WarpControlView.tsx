import { AugmentSlot } from "@ksp-gonogo/core";
import { DimmedOverlay, ToggleButton } from "@ksp-gonogo/ui";
import {
  Button,
  Cluster,
  Panel,
  PauseIcon,
  PlayIcon,
  ReadoutCaption,
  Section,
  Tooltip,
  Unit,
  type UnitValue,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useRef } from "react";
import type {
  AlarmCreator,
  PendingAlarmSummary,
} from "../shared/AlarmsLauncher";
import type { TimeTrigger } from "../TransferWindow/config";
import { NextAlarm } from "./NextAlarm";
import {
  BODY_STYLE,
  CONTROL_ROW_STYLE,
  CONTROLS_STYLE,
  FOOT_ROW_STYLE,
  FULL_LADDER_STYLE,
  RATE_ROW_STYLE,
  RATE_VALUE_STYLE,
  type RateTone,
  rateStyle,
  STEP_LADDER_STYLE,
  WARP_TO_STYLE,
  WarpButton,
} from "./styles";
import { WarpToRow } from "./WarpToRow";
import type { WarpEventTarget } from "./warpEvents";
import { formatRate, ladderFor, topWarpIndex, warpLabel } from "./warpLevels";

export interface WarpControlViewProps {
  cols: number;
  rows: number;
  scene: string | undefined;
  /** A save is loaded in a scene that cannot warp. */
  dimBody: boolean;
  currentRate: number | null;
  mode: string | null;
  currentIndex: number | null;
  /** The highest rung the game allows right now, or null when it does not say. */
  maxIndex: number | null;
  paused: boolean | undefined;
  alarmRequired: boolean;
  blockingDelay: "delay" | "no-path" | null;
  /** Counts the warp-up key presses refused for want of an alarm; each one shows the Warp up button's reason. */
  refusedPresses: number;
  oneWayDelay: UnitValue<"s"> | null | undefined;
  nextAlarm: PendingAlarmSummary | null;
  /** Absent when no alarm pipeline is mounted, which hides the warp-to targets. */
  createAlarm: AlarmCreator<TimeTrigger> | null;
  /** The event targets the warp-to row offers, each with the instant its Topic publishes or null. */
  events: readonly WarpEventTarget[];
  onSetWarp: (index: number) => void;
  onTogglePause: () => void;
  onOpenAlarms: () => void;
}

export function WarpControlView({
  cols,
  rows,
  scene,
  dimBody,
  currentRate,
  mode,
  currentIndex,
  maxIndex,
  paused,
  alarmRequired,
  blockingDelay,
  refusedPresses,
  oneWayDelay,
  nextAlarm,
  createAlarm,
  events,
  onSetWarp,
  onTogglePause,
  onOpenAlarms,
}: Readonly<WarpControlViewProps>) {
  // Content-priority decisions only: auto-fit handles whether the ladder ends up 8x1, 4x2 or 2x4.
  const showFullLadder = cols * rows >= 20 && cols >= 4 && rows >= 3;
  const showStepper = !showFullLadder && cols >= 3 && rows >= 3;
  // The rails mode name says nothing at 1×, where no warp is running to be on rails.
  const showModeCaption =
    rows >= 4 &&
    !(mode === "High" && currentRate !== null && currentRate < 1.0001);
  // Hidden at small grid counts so the rate readout keeps its own line.
  const showPause = scene === "Flight" && cols >= 4 && rows >= 4;
  const showWarpTo = createAlarm !== null && cols >= 4 && rows >= 7;

  const rateLabel = formatRate(currentRate);
  // Physics warp keeps aerodynamics live and is risky in atmosphere, so it gets its own tint.
  const rateTone: RateTone = mode?.toLowerCase().startsWith("phys")
    ? "physics"
    : "high";
  // An index that has not arrived is unknown, which is not realtime: the stepper presses and steps nothing until it does.
  const idx = currentIndex ?? 0;
  const indexKnown = currentIndex !== null;
  const downIdx = Math.max(0, idx - 1);
  const topIdx = topWarpIndex(mode);
  const upIdx = Math.min(topIdx, idx + 1);
  // A rung the game will not go past is named in the mode caption's place, so the tile gains no row.
  const capLabel =
    maxIndex !== null &&
    currentIndex !== null &&
    currentIndex > 0 &&
    currentIndex >= maxIndex &&
    maxIndex < topIdx
      ? `CAP ${warpLabel(maxIndex, mode)}`
      : null;
  const controlsRef = useRef<HTMLDivElement>(null);
  const upRung = useRef(0);
  upRung.current = ladderFor(mode).findIndex((lvl) => lvl.index === upIdx);
  // Focusing the button a refused key press stood for opens its reason tip, the same one a pointer over it shows.
  useEffect(() => {
    if (refusedPresses === 0) return;
    const root = controlsRef.current;
    const target =
      root?.querySelector<HTMLElement>('[aria-label="Warp up"]') ??
      (root?.querySelector('[role="group"]')?.children[upRung.current] as
        | HTMLElement
        | undefined);
    target?.focus({ preventScroll: true });
  }, [refusedPresses]);
  const upBlockedBecause = !indexKnown
    ? "The warp level is not reported"
    : alarmRequired
      ? "Under signal delay, warping faster needs an alarm set first"
      : "Already at the fastest warp";

  return (
    <Panel
      panelTitle="WARP"
      sections={
        <Section full>
          <DimmedOverlay show={dimBody} message="No active save">
            <div style={BODY_STYLE}>
              <div style={RATE_ROW_STYLE}>
                {showPause && (
                  <Tooltip text={paused === true ? "Resume" : "Pause"}>
                    <ToggleButton
                      pressed={paused === true}
                      tone="warn"
                      size="sm"
                      onClick={onTogglePause}
                      aria-label={
                        paused === true ? "Resume game" : "Pause game"
                      }
                    >
                      {paused === true ? (
                        <PlayIcon size={12} />
                      ) : (
                        <PauseIcon size={12} />
                      )}
                    </ToggleButton>
                  </Tooltip>
                )}
                <div style={rateStyle(rateTone)}>
                  <span
                    style={RATE_VALUE_STYLE}
                    role="img"
                    aria-label={
                      paused === true
                        ? `Time warp rate ${rateLabel}, game paused`
                        : `Time warp rate ${rateLabel}`
                    }
                  >
                    {rateLabel}
                  </span>
                  {paused === true ? (
                    <ReadoutCaption>PAUSED</ReadoutCaption>
                  ) : capLabel !== null && rows >= 4 ? (
                    <ReadoutCaption>{capLabel}</ReadoutCaption>
                  ) : (
                    showModeCaption &&
                    mode !== null &&
                    mode !== "" && <ReadoutCaption>{mode}</ReadoutCaption>
                  )}
                </div>
              </div>

              {/* The alarm row is centred under the buttons it governs, not across the rate readout too. */}
              <div style={CONTROLS_STYLE} ref={controlsRef}>
                <div style={CONTROL_ROW_STYLE}>
                  {showFullLadder && (
                    // biome-ignore lint/a11y/useSemanticElements: <fieldset> names itself from <legend> and groups form controls; these are grid buttons and it would need UA resets
                    <div
                      style={FULL_LADDER_STYLE}
                      role="group"
                      aria-label="Time warp levels"
                    >
                      {ladderFor(mode).map((lvl) => {
                        const active = currentIndex === lvl.index;
                        return (
                          <WarpButton
                            key={lvl.index}
                            type="button"
                            $active={active}
                            aria-pressed={active}
                            disabled={alarmRequired && lvl.index > idx}
                            disabledReason="Under signal delay, warping faster needs an alarm set first"
                            onClick={() => onSetWarp(lvl.index)}
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
                        disabled={!indexKnown || idx === 0}
                        disabledReason={
                          indexKnown
                            ? "Already at the slowest warp"
                            : "The warp level is not reported"
                        }
                        onClick={() => onSetWarp(downIdx)}
                        aria-label="Warp down"
                      >
                        −
                      </WarpButton>
                      <WarpButton
                        type="button"
                        $active={indexKnown && idx === 0}
                        aria-pressed={indexKnown && idx === 0}
                        onClick={() => onSetWarp(0)}
                        aria-label="Drop to realtime"
                      >
                        1×
                      </WarpButton>
                      <WarpButton
                        type="button"
                        $active={false}
                        disabled={
                          !indexKnown || alarmRequired || idx === topIdx
                        }
                        disabledReason={upBlockedBecause}
                        onClick={() => onSetWarp(upIdx)}
                        aria-label="Warp up"
                      >
                        +
                      </WarpButton>
                    </div>
                  )}

                  <AugmentSlot name="warp-control.stepper" props={{}} />
                </div>
                {alarmRequired ? (
                  <Cluster justify="center" wrap style={FOOT_ROW_STYLE}>
                    <Button type="button" onClick={onOpenAlarms}>
                      Set alarm to warp
                    </Button>
                    <ReadoutCaption>
                      {blockingDelay === "no-path" ? (
                        "No path"
                      ) : (
                        <>
                          <Unit value={oneWayDelay} /> delay
                        </>
                      )}
                    </ReadoutCaption>
                  </Cluster>
                ) : (
                  nextAlarm !== null && <NextAlarm alarm={nextAlarm} />
                )}
              </div>
              {showWarpTo && (
                <div style={WARP_TO_STYLE}>
                  <WarpToRow createAlarm={createAlarm} events={events} />
                </div>
              )}
            </div>
          </DimmedOverlay>
        </Section>
      }
    />
  );
}
