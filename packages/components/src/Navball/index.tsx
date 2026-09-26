import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { SasModeName } from "@ksp-gonogo/sitrep-client";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import {
  collapseControlStateLevel,
  enumNameOf,
  SAS_MODE_NAMES,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Countdown,
  Panel,
  Section,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { magnitudeOf } from "../shared/magnitude";
import { AttitudeIndicator } from "./AttitudeIndicator";
import { AttitudeReadout } from "./AttitudeReadout";
import { ControlSurface } from "./ControlSurface";
import { ControlToggles } from "./ControlToggles";
import { type NavballConfig, navballActions } from "./config";
import { useAxisStreams, useThrottleCommand } from "./controlStreams";
import { NavballConfigForm } from "./NavballConfigForm";
import { lastObserved, numericOrNull } from "./readings";
import { badgeSasMode } from "./sasModes";
import { ThrottleGauge } from "./ThrottleGauge";
import { MIN_DIAL_PX, useDialFit } from "./useDialFit";
import { useFlyByWire } from "./useFlyByWire";
import { type TrimField, useNavballInputs } from "./useNavballInputs";
import { useSasControls } from "./useSasControls";

export { SAS_MODES, sasModeOrdinal } from "./sasModes";

const topics = defineTopicManifest({
  channels: [
    "vessel.attitude",
    "vessel.control",
    "vessel.comms",
    "comms.delay",
  ],
  fields: [
    "vessel.attitude.heading",
    "vessel.attitude.pitch",
    "vessel.attitude.roll",
    "vessel.attitude.headingRootFrame",
    "vessel.attitude.pitchRootFrame",
    "vessel.attitude.rollRootFrame",
    "vessel.control.sasMode",
    "vessel.control.sas",
    "vessel.control.precisionControl",
    "vessel.control.rcs",
    "vessel.control.throttle",
    "vessel.comms.controlState",
    "comms.delay.oneWaySeconds",
  ],
});

/**
 * One-way delay above which armed fly-by-wire warns: the felt loop lag is about
 * twice one-way, and past 2s round-trip closed-loop stick flying stops working.
 */
const FBW_DELAY_WARN_SECONDS = 1.0;

function NavballComponent({
  config,
  onConfigChange,
  w,
  h,
}: Readonly<ComponentProps<NavballConfig>>) {
  const useCoM = config?.useCoMFrame === true;
  const controlMode = config?.controlMode === true;

  // The unsuffixed trio is the CoM frame and `*RootFrame` the root-part frame.
  const attitudeReading = useTelemetry("vessel.attitude");
  const attitude = lastObserved(attitudeReading);
  const attitudeObserved = attitudeReading.state === "observed";
  const heading = numericOrNull(
    attitude?.[useCoM ? "heading" : "headingRootFrame"],
  );
  const pitch = numericOrNull(attitude?.[useCoM ? "pitch" : "pitchRootFrame"]);
  const roll = numericOrNull(attitude?.[useCoM ? "roll" : "rollRootFrame"]);

  // Buttons show the last confirmed control state; in-flight commands are shown by the failure echo and the delay strip.
  const control = lastObserved(topics.useTelemetry("vessel.control"));
  const sasMode = enumNameOf<SasModeName>(SAS_MODE_NAMES, control?.sasMode);
  const sasBadgeMode = sasMode ? badgeSasMode(sasMode) : "";
  const throttle = magnitudeOf(control?.throttle);
  // Only a confirmed `*None` control state disables the buttons: greying out the stick is a claim about the craft.
  const comms = lastObserved(topics.useTelemetry("vessel.comms"));
  const controlLevel =
    comms === undefined
      ? undefined
      : collapseControlStateLevel(comms.controlState);
  const isControllable = controlLevel === undefined || controlLevel > 0;

  const { throttleCmd, setThrottleCmd, throttleKnown, throttleStream } =
    useThrottleCommand(throttle);
  const { axisStreams, setAxis } = useAxisStreams();

  const {
    sasRaw,
    rcsRaw,
    toggleSas,
    toggleRcs,
    setSasMode,
    failedSasModes,
    dismissSasFailure,
  } = useSasControls(control);
  const { fbwArmed, armFbw, disarmFbw } = useFlyByWire();

  // Trim has no readback to anchor a control stream, so it sends `setAxes` one field at a time, never clobbering a live axis.
  const trimCmd = useCommand("vessel.control.setAxes");
  usePanelDelay(trimCmd);
  const sendTrim = (field: TrimField, raw: number) => {
    void trimCmd.send({ [field]: raw });
  };

  /*
   * `oneWaySeconds` is 0 with the delay feature off. Read as last-observed: a
   * craft whose delay reading went quiet has not stopped being far away.
   */
  const delaySeconds = magnitudeOf(
    lastObserved(useTelemetry("comms.delay"))?.oneWaySeconds,
  );
  const delayHigh =
    delaySeconds !== null && delaySeconds > FBW_DELAY_WARN_SECONDS;
  const showFbwDelayWarning = fbwArmed && delayHigh;

  useNavballInputs({
    toggleControlMode: () =>
      onConfigChange?.({ ...(config ?? {}), controlMode: !controlMode }),
    armFbw,
    disarmFbw,
    toggleSas,
    toggleRcs,
    setSasMode,
    setThrottleCmd,
    throttleKnown,
    setAxis,
    sendTrim,
  });

  // The control surface needs ~350px beyond the dial, so a smaller tile degrades control mode to a plain dial.
  const cols = w ?? 8;
  const rows = h ?? 11;
  const showControlSurface = controlMode && rows >= 18 && cols >= 7;
  const { dialFit, readoutAcross, attachAttitude } = useDialFit({
    reserveThrottle: cols >= 5,
    controlSurface: showControlSurface,
  });
  /*
   * Grid units say whether a dial is wanted; the measured fit says whether one
   * will go. The dial draws only off an observed attitude: a held one is
   * indistinguishable from a live one, and attitude cannot be reckoned forward,
   * since torque from SAS or an in-flight command changes it.
   */
  const dialWanted = rows >= 6 && cols >= 4 && dialFit >= MIN_DIAL_PX;
  const showDial = dialWanted && attitudeObserved;
  const showThrottleColumn = showDial && cols >= 5;
  // In the body, not the header aside, which collapses on a measured fit and would take contributed alerts with it.
  const showControlRow = cols >= 5;

  return (
    <Panel
      panelTitle={showControlSurface ? "GNC CONTROL" : "ATTITUDE"}
      sections={[
        <Section
          key="attitude"
          fill
          {...(showDial ? {} : { style: READOUT_FLOOR })}
        >
          <div ref={attachAttitude} style={ATTITUDE_COLUMN}>
            {showDial ? (
              <div style={DIAL_WRAP}>
                <AttitudeIndicator
                  heading={heading}
                  pitch={pitch}
                  roll={roll}
                  size={dialFit}
                />
                {showThrottleColumn && <ThrottleGauge throttle={throttle} />}
              </div>
            ) : (
              <div style={NUMERIC_READOUT}>
                <AttitudeReadout
                  heading={heading}
                  pitch={pitch}
                  roll={roll}
                  across={readoutAcross}
                  dialSuppressed={dialWanted}
                  reading={attitudeReading}
                />
              </div>
            )}
          </div>
        </Section>,
        showControlRow ? (
          <Section key="controls" full>
            <ControlToggles
              disabled={!isControllable}
              sas={sasRaw}
              sasBadgeMode={sasBadgeMode}
              rcs={rcsRaw}
              precision={control?.precisionControl}
              onToggleSas={toggleSas}
              onToggleRcs={toggleRcs}
            />
          </Section>
        ) : null,
        showControlSurface ? (
          <Section key="control">
            <ControlSurface
              disabled={!isControllable}
              sasMode={sasMode ?? null}
              throttleCmd={throttleKnown ? throttleCmd : null}
              onSetThrottleCmd={setThrottleCmd}
              throttleStream={throttleStream}
              axisStreams={axisStreams}
              fbwArmed={fbwArmed}
              onArmFbw={armFbw}
              onDisarmFbw={disarmFbw}
              onSetSasMode={setSasMode}
              failedSasModes={failedSasModes}
              onDismissSasFailure={dismissSasFailure}
              showFbwDelayWarning={showFbwDelayWarning}
              delaySeconds={delaySeconds}
            />
          </Section>
        ) : null,
      ]}
      /* The aside carries alerts only; control state lives in the body. */
      panelAside={
        showFbwDelayWarning && delaySeconds !== null ? (
          <Badge severity="warning" size="sm">
            FBW · <Countdown value={delaySeconds} precise /> DELAY
          </Badge>
        ) : undefined
      }
    />
  );
}

/**
 * Stops the attitude section shrinking under the numeric readout, which cannot
 * resize like the dial: a crushed tile scrolls instead of painting the readout
 * over the section below. It still grows, so a growing tile can measure its
 * way back to a dial.
 */
const READOUT_FLOOR: CSSProperties = { flexShrink: 0 };

/** The measured box: the same element in both the dial and readout branches. */
const ATTITUDE_COLUMN: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const DIAL_WRAP: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  // Off the spacing ladder: a term in the ResizeObserver's 42px throttle reserve (32px bar plus this gap).
  gap: "10px",
  justifyContent: "center",
};

const NUMERIC_READOUT: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  flex: 1,
  justifyContent: "center",
};

registerComponent<NavballConfig>({
  id: "navball",
  name: "Navball / Attitude Director",
  description:
    "Attitude indicator + control surface. Reads heading/pitch/roll and exposes a deep action surface (every SAS mode, throttle, fly-by-wire pitch/yaw/roll, RCS translation and trim) so a hardware stick mapped via the Inputs tab can fly the vessel.",
  tags: ["telemetry", "control"],
  defaultSize: { w: 8, h: 11 },
  // 4x5 is where the stacked readout stops clipping vertically.
  minSize: { w: 4, h: 5 },
  component: NavballComponent,
  configComponent: NavballConfigForm,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: { useCoMFrame: false, controlMode: false },
  actions: navballActions,
  pushable: true,
  requires: ["flight"],
});

export { NavballComponent };
