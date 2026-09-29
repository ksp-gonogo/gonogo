import type { ControlStream } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  ControlDelayStream,
  Countdown,
  MARKER_ICONS,
  NULL_DISPLAY,
  Slider,
  StatusIndicator,
  ToggleButton,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ComponentProps, CSSProperties } from "react";
import { clamp } from "./input";
import {
  modeShort,
  SAS_MODE_MARKERS,
  SAS_MODES,
  type SasMode,
} from "./sasModes";
import type { FbwState } from "./useFlyByWire";

interface ControlSurfaceProps {
  disabled: boolean;
  sasMode: string | null;
  /** Commanded throttle (0..1), tracking the readback until touched; `null` while there is neither. */
  throttleCmd: number | null;
  onSetThrottleCmd: (next: number | ((v: number) => number)) => void;
  throttleStream: ControlStream;
  /** The fly-by-wire attitude and translation streams, drawn on the same delay graph as the throttle. */
  axisStreams: ControlStream[];
  fbwState: FbwState;
  onArmFbw: () => void;
  onDisarmFbw: () => void;
  onSetSasMode: (mode: SasMode) => void;
  /** SAS modes whose command is overdue or lost, mapped to that command's id so the button can dismiss it. */
  failedSasModes: Map<SasMode, string>;
  onDismissSasFailure: (id: string) => void;
  showFbwDelayWarning: boolean;
  delaySeconds: number | null;
  /** The one-way delay as read, so a held figure is marked. */
  oneWayDelay: ComponentProps<typeof Countdown>["value"];
}

/** A press disarms whenever the craft may be holding the stick, so the one safe action is always a click away. */
const FBW_VIEW: Record<
  FbwState,
  { label: string; hint: string; press: "arm" | "disarm" }
> = {
  off: { label: "Arm FBW", hint: "Stick inputs off", press: "arm" },
  arming: { label: "Arming FBW", hint: "Stick inputs off", press: "disarm" },
  armed: { label: "FBW ARMED", hint: "Stick inputs live", press: "disarm" },
  disarming: {
    label: "Disarming FBW",
    hint: "Stick inputs live",
    press: "disarm",
  },
  unconfirmed: {
    label: "FBW unconfirmed",
    hint: "Stick inputs may be live",
    press: "disarm",
  },
};

export function ControlSurface({
  disabled,
  sasMode,
  throttleCmd,
  onSetThrottleCmd,
  throttleStream,
  axisStreams,
  fbwState,
  onArmFbw,
  onDisarmFbw,
  onSetSasMode,
  failedSasModes,
  onDismissSasFailure,
  showFbwDelayWarning,
  delaySeconds,
  oneWayDelay,
}: ControlSurfaceProps) {
  return (
    <div style={CONTROL_WRAP}>
      <div style={GROUP}>
        <div style={GROUP_LABEL}>SAS Mode</div>
        <div style={BUTTON_GRID}>
          {SAS_MODES.map((mode) => {
            const failedId = failedSasModes.get(mode);
            const isFailed = failedId !== undefined;
            return (
              <ToggleButton
                key={mode}
                type="button"
                active={sasMode === mode}
                data-failed={isFailed ? "true" : undefined}
                aria-label={
                  isFailed
                    ? `SAS ${mode} command failed, activate to dismiss`
                    : undefined
                }
                onClick={() =>
                  isFailed ? onDismissSasFailure(failedId) : onSetSasMode(mode)
                }
                disabled={disabled}
              >
                {(() => {
                  const markerId = SAS_MODE_MARKERS[mode];
                  if (!markerId) return null;
                  const Marker = MARKER_ICONS[markerId];
                  return <Marker size={14} />;
                })()}
                {modeShort(mode)}
              </ToggleButton>
            );
          })}
        </div>
      </div>

      <div style={GROUP}>
        <div style={GROUP_LABEL}>Throttle</div>
        <div style={SLIDER_ROW}>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={throttleCmd ?? 0}
            onChange={(e) => onSetThrottleCmd(Number(e.target.value))}
            disabled={disabled}
            aria-label="Throttle"
            style={SLIDER}
          />
          <span style={SLIDER_VAL}>
            {throttleCmd === null ? (
              NULL_DISPLAY
            ) : (
              <Unit value={value("%", throttleCmd * 100)} decimals={0} />
            )}
          </span>
        </div>
        <div style={BUTTON_GRID}>
          <Button
            type="button"
            onClick={() => onSetThrottleCmd(0)}
            disabled={disabled}
          >
            ZERO
          </Button>
          <Button
            type="button"
            onClick={() => onSetThrottleCmd((v) => clamp(v - 0.1, 0, 1))}
            disabled={disabled || throttleCmd === null}
          >
            −10%
          </Button>
          <Button
            type="button"
            onClick={() => onSetThrottleCmd((v) => clamp(v + 0.1, 0, 1))}
            disabled={disabled || throttleCmd === null}
          >
            +10%
          </Button>
          <Button
            type="button"
            onClick={() => onSetThrottleCmd(1)}
            disabled={disabled}
          >
            FULL
          </Button>
        </div>
        {/* Renders nothing at near-zero delay, so it is always mounted. */}
        <ControlDelayStream
          streams={[throttleStream, ...axisStreams]}
          ariaLabel="Navball: controls in flight"
        />
      </div>

      <div style={GROUP}>
        <div style={GROUP_LABEL}>Fly-by-wire</div>
        <div style={FBW_ROW}>
          <ToggleButton
            type="button"
            active={fbwState === "armed"}
            onClick={
              FBW_VIEW[fbwState].press === "arm" ? onArmFbw : onDisarmFbw
            }
            disabled={disabled}
          >
            {FBW_VIEW[fbwState].label}
          </ToggleButton>
          <span style={FBW_HINT}>{FBW_VIEW[fbwState].hint}</span>
        </div>
        {showFbwDelayWarning && delaySeconds !== null && (
          <StatusIndicator tone="warn">
            <span role="status" aria-live="polite">
              High signal delay
            </span>{" "}
            (<Countdown value={oneWayDelay} precise />
            ): stick input lands one round trip late
          </StatusIndicator>
        )}
      </div>
    </div>
  );
}

const CONTROL_WRAP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  paddingTop: "var(--inset-below-rule)",
  borderTop: "1px solid var(--color-border-subtle)",
};

const GROUP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
};

const GROUP_LABEL: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
};

/**
 * 68px holds a mode button's padding, marker, gap and three-letter label. A
 * narrower column silently squeezes the marker SVG to zero width first.
 */
const BUTTON_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(68px, 1fr))",
  gap: "var(--gap-related)",
};

const SLIDER_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
};

const SLIDER: CSSProperties = { flex: 1 };

const SLIDER_VAL: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  minWidth: "36px",
  textAlign: "right",
};

const FBW_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
};

const FBW_HINT: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
};
