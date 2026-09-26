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
  Unit,
  type UnitValue,
} from "@ksp-gonogo/ui-kit";
import type { PendingAlarmSummary } from "../shared/AlarmsLauncher";
import { NextAlarm } from "./NextAlarm";
import {
  BODY_STYLE,
  FOOT_ROW_STYLE,
  FULL_LADDER_STYLE,
  RATE_VALUE_STYLE,
  type RateTone,
  rateStyle,
  STEP_LADDER_STYLE,
  WarpButton,
} from "./styles";
import { formatRate, HIGH_LEVELS, TOP_WARP_INDEX } from "./warpLevels";

export interface WarpControlViewProps {
  cols: number;
  rows: number;
  scene: string | undefined;
  /** A save is loaded in a scene that cannot warp. */
  dimBody: boolean;
  currentRate: number | null;
  mode: string | null;
  currentIndex: number | null;
  paused: boolean | undefined;
  alarmRequired: boolean;
  blockingDelay: "delay" | "no-path" | null;
  oneWayDelay: UnitValue<"s"> | null | undefined;
  nextAlarm: PendingAlarmSummary | null;
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
  paused,
  alarmRequired,
  blockingDelay,
  oneWayDelay,
  nextAlarm,
  onSetWarp,
  onTogglePause,
  onOpenAlarms,
}: Readonly<WarpControlViewProps>) {
  // Content-priority decisions only: auto-fit handles whether the ladder ends up 8x1, 4x2 or 2x4.
  const showFullLadder = cols * rows >= 20 && cols >= 4 && rows >= 3;
  const showStepper = !showFullLadder && cols >= 3 && rows >= 3;
  const showModeCaption = rows >= 4;

  const rateLabel = formatRate(currentRate);
  // Physics warp keeps aerodynamics live and is risky in atmosphere, so it gets its own tint.
  const rateTone: RateTone = mode?.toLowerCase().startsWith("phys")
    ? "physics"
    : "high";
  const idx = currentIndex ?? 0;
  const downIdx = Math.max(0, idx - 1);
  const upIdx = Math.min(TOP_WARP_INDEX, idx + 1);

  return (
    <Panel
      panelTitle="WARP"
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
                  active={paused === true}
                  tone="warn"
                  size="sm"
                  onClick={onTogglePause}
                  aria-label={paused === true ? "Resume game" : "Pause game"}
                  title={paused === true ? "Resume" : "Pause"}
                >
                  {paused === true ? (
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
                    disabled={idx === 0}
                    onClick={() => onSetWarp(downIdx)}
                    aria-label="Warp down"
                  >
                    −
                  </WarpButton>
                  <WarpButton
                    type="button"
                    $active={idx === 0}
                    aria-pressed={idx === 0}
                    onClick={() => onSetWarp(0)}
                    aria-label="Drop to realtime"
                  >
                    1×
                  </WarpButton>
                  <WarpButton
                    type="button"
                    $active={false}
                    disabled={alarmRequired || idx === TOP_WARP_INDEX}
                    onClick={() => onSetWarp(upIdx)}
                    aria-label="Warp up"
                  >
                    +
                  </WarpButton>
                </div>
              )}

              <AugmentSlot name="warp-control.stepper" props={{}} />

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
          </DimmedOverlay>
        </Section>
      }
    />
  );
}
