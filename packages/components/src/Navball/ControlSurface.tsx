import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  CommandSlider,
  Countdown,
  Disclosure,
  MARKER_ICONS,
  StatusIndicator,
  ToggleButton,
  Unit,
} from "@ksp-gonogo/ui-kit";
import {
  type ComponentProps,
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";
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
  /** The SAS modes the craft can hold right now; `null` while it does not say, when every mode is offered. */
  availableSasModes: ReadonlySet<SasMode> | null;
  /** The throttle a step works from (0..1): the newest input in flight, else the craft's; `null` while there is neither. */
  throttleBase: number | null;
  /** The throttle the craft is expected to hold now (0..1), given every input that has reached it. */
  throttleExpected: number | null;
  /** The craft's last reported throttle (0..1) and its held caption, passed only while its readings are held. */
  throttleLastSeen: { value: number; caption: string } | null;
  onSetThrottleCmd: (next: number | ((v: number) => number)) => void;
  fbwState: FbwState;
  onArmFbw: () => void;
  onDisarmFbw: () => void;
  onSetSasMode: (mode: SasMode) => void;
  /** SAS modes whose command is overdue or lost, mapped to that command's id so the button can dismiss it. */
  unconfirmedSasModes: Map<SasMode, string>;
  onDismissSasUnconfirmed: (id: string) => void;
  showFbwDelayWarning: boolean;
  delaySeconds: number | null;
  /** The one-way delay as read, so a held figure is marked. */
  oneWayDelay: ComponentProps<typeof Countdown>["value"];
  /** Called with whether any section is open, each time that changes. */
  onSectionsOpenChange?: (anyOpen: boolean) => void;
}

/** A press disarms whenever the craft may be holding the stick, so the one safe action is always a click away. */
export const FBW_VIEW: Record<
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

/** Why every control of the surface is dark while the vessel cannot be flown. */
const NOT_CONTROLLABLE = "The vessel is not controllable";

export function ControlSurface({
  disabled,
  sasMode,
  availableSasModes,
  throttleBase,
  throttleExpected,
  throttleLastSeen,
  onSetThrottleCmd,
  fbwState,
  onArmFbw,
  onDisarmFbw,
  onSetSasMode,
  unconfirmedSasModes,
  onDismissSasUnconfirmed,
  showFbwDelayWarning,
  delaySeconds,
  oneWayDelay,
  onSectionsOpenChange,
}: ControlSurfaceProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onSectionsOpenChange);
  onChangeRef.current = onSectionsOpenChange;
  const anyOpenRef = useRef(false);
  const reportOpen = useCallback((anyOpen: boolean) => {
    if (anyOpen === anyOpenRef.current) return;
    anyOpenRef.current = anyOpen;
    onChangeRef.current?.(anyOpen);
  }, []);
  /*
   * The press is reported in the click's own capture phase, so the layout that
   * holds what sits above the sections is committed together with the section
   * opening. Watching the attribute afterwards lands a frame late, and the
   * column would shrink first.
   */
  const reportPress = (e: MouseEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    const header = (e.target as Element).closest("button[aria-expanded]");
    if (!el || !header || !el.contains(header)) return;
    const opening = header.getAttribute("aria-expanded") === "false";
    const open = el.querySelectorAll('button[aria-expanded="true"]').length;
    reportOpen(opening || open > 1);
  };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() =>
      reportOpen(el.querySelector('button[aria-expanded="true"]') !== null),
    );
    mo.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded"],
    });
    return () => {
      mo.disconnect();
      reportOpen(false);
    };
  }, [reportOpen]);
  const throttleBlockedBecause = disabled
    ? NOT_CONTROLLABLE
    : "The throttle command is not reported";
  return (
    <div ref={wrapRef} style={CONTROL_WRAP} onClickCapture={reportPress}>
      <Disclosure
        variant="inline"
        panelHeight="auto"
        label={<span style={GROUP_LABEL}>SAS Mode</span>}
        aria-label="SAS Mode"
      >
        <div style={BUTTON_GRID}>
          {SAS_MODES.map((mode) => {
            const unconfirmedId = unconfirmedSasModes.get(mode);
            const isUnconfirmed = unconfirmedId !== undefined;
            const cannotHold = availableSasModes?.has(mode) === false;
            return (
              <ToggleButton
                key={mode}
                type="button"
                pressed={sasMode === mode}
                data-unconfirmed={isUnconfirmed ? "true" : undefined}
                aria-label={
                  isUnconfirmed
                    ? `SAS ${mode} command unconfirmed, may have run, activate to dismiss`
                    : undefined
                }
                onClick={() =>
                  isUnconfirmed
                    ? onDismissSasUnconfirmed(unconfirmedId)
                    : onSetSasMode(mode)
                }
                disabled={disabled || (cannotHold && !isUnconfirmed)}
                disabledReason={disabled ? NOT_CONTROLLABLE : undefined}
              >
                {(() => {
                  const markerId = SAS_MODE_MARKERS[mode];
                  if (!markerId) return null;
                  const Marker = MARKER_ICONS[markerId];
                  return <Marker size="var(--icon-size-control)" />;
                })()}
                {modeShort(mode)}
              </ToggleButton>
            );
          })}
        </div>
      </Disclosure>

      <Disclosure
        variant="inline"
        panelHeight="auto"
        label={<span style={GROUP_LABEL}>Throttle</span>}
        aria-label="Throttle controls"
      >
        <div style={GROUP}>
          <CommandSlider
            min={0}
            max={1}
            step={0.01}
            commanded={throttleBase}
            expected={throttleExpected}
            lastSeen={throttleLastSeen?.value ?? null}
            lastSeenCaption={throttleLastSeen?.caption}
            onChange={(v) => onSetThrottleCmd(v)}
            figure={(v) => <Unit value={value("%", v * 100)} decimals={0} />}
            disabled={disabled}
            aria-label="Throttle"
          />
          <div style={BUTTON_GRID}>
            <Button
              type="button"
              onClick={() => onSetThrottleCmd(0)}
              disabled={disabled}
              disabledReason={NOT_CONTROLLABLE}
            >
              ZERO
            </Button>
            <Button
              type="button"
              onClick={() => onSetThrottleCmd((v) => clamp(v - 0.1, 0, 1))}
              disabled={disabled || throttleBase === null}
              disabledReason={throttleBlockedBecause}
            >
              −10%
            </Button>
            <Button
              type="button"
              onClick={() => onSetThrottleCmd((v) => clamp(v + 0.1, 0, 1))}
              disabled={disabled || throttleBase === null}
              disabledReason={throttleBlockedBecause}
            >
              +10%
            </Button>
            <Button
              type="button"
              onClick={() => onSetThrottleCmd(1)}
              disabled={disabled}
              disabledReason={NOT_CONTROLLABLE}
            >
              FULL
            </Button>
          </div>
        </div>
      </Disclosure>

      <div style={GROUP}>
        <div style={GROUP_LABEL}>Fly-by-wire</div>
        <div style={FBW_ROW}>
          <ToggleButton
            type="button"
            pressed={fbwState === "armed"}
            onClick={
              FBW_VIEW[fbwState].press === "arm" ? onArmFbw : onDisarmFbw
            }
            disabled={disabled}
            disabledReason={NOT_CONTROLLABLE}
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

const FBW_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
};

const FBW_HINT: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
};
