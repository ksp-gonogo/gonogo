import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  PerfBudget,
  registerComponent,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { ControlStream, SasModeName } from "@ksp-gonogo/sitrep-client";
import {
  observedAt,
  type TopicReading,
  useCommand,
  useControlStream,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import {
  collapseControlStateLevel,
  enumNameOf,
  SAS_MODE_NAMES,
  SasMode as SasModeEnum,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  BigReadout,
  Button,
  ConfigForm,
  ControlDelayStream,
  Countdown,
  Field,
  FieldHint,
  FieldLabel,
  MARKER_ICONS,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Select,
  StatusIndicator,
  Switch,
  ToggleButton,
  Unit,
  useCommandFailures,
  useModalSaveBar,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { asQuantityish, magnitudeOf } from "../shared/magnitude";
import { AttitudeIndicator } from "./AttitudeIndicator";

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

/** The smallest dial worth drawing: a floor on whether to draw, never a size clamp. */
const MIN_DIAL_PX = 80;

/**
 * Measured height of what `AttitudeIndicator` puts below the dial (heading
 * strip, readout row and gaps). A column shorter than
 * `MIN_DIAL_PX + ATTITUDE_CHROME_PX` holds no dial at all.
 */
const ATTITUDE_CHROME_PX = 74;

/**
 * Measured width the numeric readout needs for HDG, PCH and RLL on one line:
 * the widest readings (`359°`, `-90°`, `-180°`) plus two gaps at the
 * coarse-pointer type size. Each `1fr` column floors at its own content, so the
 * row fits at the sum, not at three times the widest cell. Below this the grid
 * overflows rather than clipping, so the overlap gate sees it.
 */
const READOUT_TRIPLE_PX = 158;

/**
 * Dispatch-rate budget for the throttle control stream, wired through the
 * hook's `onDispatch` since sitrep-client cannot depend on core. About 5x one
 * 10 Hz axis on one instance.
 */
const CONTROL_STREAM_BUDGET = new PerfBudget({
  name: "Navball control-stream dispatch/sec",
  threshold: 60,
  windowMs: 1000,
  unit: "dispatches",
});

/**
 * The SAS modes the grid offers a button for: every `SasMode` member except the
 * `Unknown` fallback. The order is the grid's layout only, never the wire
 * ordinal.
 */
const SAS_MODES: readonly Exclude<SasModeName, "Unknown">[] = [
  "StabilityAssist",
  "Prograde",
  "Retrograde",
  "Normal",
  "Antinormal",
  "RadialIn",
  "RadialOut",
  "Target",
  "AntiTarget",
  "Maneuver",
];
type SasMode = (typeof SAS_MODES)[number];

/** The navball glyph for each SAS mode that names a direction; StabilityAssist holds the current attitude and has none. */
const SAS_MODE_MARKERS: Partial<Record<SasMode, keyof typeof MARKER_ICONS>> = {
  Prograde: "prograde",
  Retrograde: "retrograde",
  Normal: "normal",
  Antinormal: "antiNormal",
  RadialIn: "radialIn",
  RadialOut: "radialOut",
  Target: "target",
  AntiTarget: "antiTarget",
  Maneuver: "maneuver",
};

/** The wire ordinal for one SAS mode, from the generated enum rather than the layout order of {@link SAS_MODES}. */
export function sasModeOrdinal(mode: SasMode): number {
  return SasModeEnum[mode];
}

export { SAS_MODES };

interface NavballConfig {
  /** When true, read the CoM-referenced attitude frame (`heading`/`pitch`/`roll`); by default the root-part frame (`*RootFrame`). */
  useCoMFrame?: boolean;
  /** When true, render the control surface; otherwise show display-only. */
  controlMode?: boolean;
}

/** One action per axis and mode so each maps to its own input; ordered like the visible button rows. */
const navballActions = [
  { id: "take-control", label: "Toggle control mode", accepts: ["button"] },
  { id: "arm-fbw", label: "Arm FBW", accepts: ["button"] },
  { id: "disarm-fbw", label: "Disarm FBW", accepts: ["button"] },
  { id: "toggle-sas", label: "Toggle SAS", accepts: ["button"] },
  { id: "toggle-rcs", label: "Toggle RCS", accepts: ["button"] },
  { id: "toggle-precision", label: "Toggle precision", accepts: ["button"] },
  { id: "kill-rotation", label: "Kill rotation (SAS)", accepts: ["button"] },
  { id: "sas-stability", label: "SAS: Stability", accepts: ["button"] },
  { id: "sas-prograde", label: "SAS: Prograde", accepts: ["button"] },
  { id: "sas-retrograde", label: "SAS: Retrograde", accepts: ["button"] },
  { id: "sas-normal", label: "SAS: Normal", accepts: ["button"] },
  { id: "sas-antinormal", label: "SAS: Anti-normal", accepts: ["button"] },
  { id: "sas-radial-in", label: "SAS: Radial in", accepts: ["button"] },
  { id: "sas-radial-out", label: "SAS: Radial out", accepts: ["button"] },
  { id: "sas-target", label: "SAS: Target", accepts: ["button"] },
  { id: "sas-anti-target", label: "SAS: Anti-target", accepts: ["button"] },
  { id: "sas-maneuver", label: "SAS: Maneuver", accepts: ["button"] },
  { id: "set-throttle", label: "Set throttle", accepts: ["analog"] },
  { id: "throttle-up", label: "Throttle up 10%", accepts: ["button"] },
  { id: "throttle-down", label: "Throttle down 10%", accepts: ["button"] },
  { id: "throttle-zero", label: "Throttle zero", accepts: ["button"] },
  { id: "throttle-full", label: "Throttle full", accepts: ["button"] },
  { id: "set-pitch", label: "Pitch axis", accepts: ["analog"] },
  { id: "set-yaw", label: "Yaw axis", accepts: ["analog"] },
  { id: "set-roll", label: "Roll axis", accepts: ["analog"] },
  { id: "translate-x", label: "RCS X", accepts: ["analog"] },
  { id: "translate-y", label: "RCS Y", accepts: ["analog"] },
  { id: "translate-z", label: "RCS Z", accepts: ["analog"] },
  { id: "set-pitch-trim", label: "Pitch trim", accepts: ["analog"] },
  { id: "set-yaw-trim", label: "Yaw trim", accepts: ["analog"] },
  { id: "set-roll-trim", label: "Roll trim", accepts: ["analog"] },
] as const satisfies readonly ActionDefinition[];

type NavballActions = typeof navballActions;

/** The last real observation behind a reading, never a modelled value. */
function lastObserved<T>(reading: TopicReading<T>): T | undefined {
  switch (reading.state) {
    case "observed":
    case "stale":
      return reading.value;
    default:
      return undefined;
  }
}

/**
 * Says why the dial is not there, under the numbers that replaced it.
 * `dialSuppressed` separates a non-current attitude from a tile merely too
 * small for a dial, which needs no explanation.
 */
function AttitudeCurrency({
  reading,
  dialSuppressed,
}: {
  reading: TopicReading<unknown>;
  dialSuppressed: boolean;
}) {
  if (reading.state === "observed") return null;
  if (reading.state === "pending") {
    return <ReadoutCaption>Waiting for attitude telemetry</ReadoutCaption>;
  }
  if (reading.state === "unowned") {
    return <ReadoutCaption>No attitude channel on this install</ReadoutCaption>;
  }
  if (reading.state === "absent") {
    return <ReadoutCaption>No attitude reported</ReadoutCaption>;
  }
  return (
    <StaleCaption
      label={dialSuppressed ? "attitude at last contact" : "at last contact"}
      reading={reading}
    />
  );
}

/** The dated half of the caption, its own component so the per-frame `useViewUt` subscription exists only while a caption is on screen. */
function StaleCaption({
  label,
  reading,
}: {
  label: string;
  reading: TopicReading<unknown>;
}) {
  const viewUt = useViewUt();
  // Clamped: an out-of-order sample can sit just ahead of the frame.
  const observedUt = observedAt(reading);
  const ageSec =
    viewUt && observedUt
      ? Math.max(0, viewUt.minus(observedUt).magnitude)
      : undefined;
  return (
    <ReadoutCaption>
      <span role="status">{label}</span>
      {ageSec !== undefined && (
        <>
          , <Unit value={value("s", ageSec)} /> ago
        </>
      )}
    </ReadoutCaption>
  );
}

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

  /*
   * The commanded throttle tracks the readback until the operator first touches
   * it, and the stream commands nothing until then: neither a 0 seeded from an
   * unread readback nor, under delay, a round-trip-old readback sent back at the
   * craft. A vessel switch re-arms the latch.
   */
  const [throttleCmd, setThrottleCmdState] = useState(throttle ?? 0);
  const throttleTouchedRef = useRef(false);
  // State as well as the ref: a first touch to the value already held changes nothing else, and the stream learns of it only through a render.
  const [throttleTouched, setThrottleTouched] = useState(false);
  useEffect(() => {
    if (!throttleTouchedRef.current) setThrottleCmdState(throttle ?? 0);
  }, [throttle]);
  const setThrottleCmd = (next: number | ((v: number) => number)) => {
    throttleTouchedRef.current = true;
    setThrottleTouched(true);
    setThrottleCmdState(next);
  };
  // An id does not decay, so a stale one still names the vessel.
  const activeVesselId = lastObserved(
    useTelemetry("vessel.identity"),
  )?.vesselId;
  const prevVesselIdRef = useRef(activeVesselId);
  useEffect(() => {
    if (activeVesselId !== prevVesselIdRef.current) {
      prevVesselIdRef.current = activeVesselId;
      throttleTouchedRef.current = false;
      setThrottleTouched(false);
      // Re-seed here: the new vessel's throttle may have landed in the same frame, so the `throttle` effect may not fire again.
      setThrottleCmdState(throttle ?? 0);
    }
  }, [activeVesselId, throttle]);
  /** With neither a readback nor a command, a 10% step would be a step from a guess. */
  const throttleKnown = throttleTouched || throttle !== null;
  const throttleStream: ControlStream = useControlStream(
    "vessel.control.throttle",
    throttleTouched ? throttleCmd : null,
    {
      label: "Throttle",
      range: "unit",
      onDispatch: () => CONTROL_STREAM_BUDGET.record(),
    },
  );

  // KSP re-zeroes a raw axis every physics frame, so each fly-by-wire axis is a control stream, not a one-shot command.
  const [pitchCmd, setPitchCmd] = useState<number | null>(null);
  const [yawCmd, setYawCmd] = useState<number | null>(null);
  const [rollCmd, setRollCmd] = useState<number | null>(null);
  const [translateXCmd, setTranslateXCmd] = useState<number | null>(null);
  const [translateYCmd, setTranslateYCmd] = useState<number | null>(null);
  const [translateZCmd, setTranslateZCmd] = useState<number | null>(null);
  const axisStreamOpts = (label: string) => ({
    label,
    range: "signed" as const,
    onDispatch: () => CONTROL_STREAM_BUDGET.record(),
  });
  const pitchStream = useControlStream(
    "vessel.control.pitch",
    pitchCmd,
    axisStreamOpts("Pitch"),
  );
  const yawStream = useControlStream(
    "vessel.control.yaw",
    yawCmd,
    axisStreamOpts("Yaw"),
  );
  const rollStream = useControlStream(
    "vessel.control.roll",
    rollCmd,
    axisStreamOpts("Roll"),
  );
  const translateXStream = useControlStream(
    "vessel.control.translationX",
    translateXCmd,
    axisStreamOpts("RCS X"),
  );
  const translateYStream = useControlStream(
    "vessel.control.translationY",
    translateYCmd,
    axisStreamOpts("RCS Y"),
  );
  const translateZStream = useControlStream(
    "vessel.control.translationZ",
    translateZCmd,
    axisStreamOpts("RCS Z"),
  );
  const axisStreams: ControlStream[] = [
    pitchStream,
    yawStream,
    rollStream,
    translateXStream,
    translateYStream,
    translateZStream,
  ];

  const sasCmd = useCommand("vessel.control.setSas");
  const rcsCmd = useCommand("vessel.control.setRcs");
  const sasModeCmd = useCommand("vessel.control.setSasMode");
  const fbwCmd = useCommand("vessel.control.setFlyByWire");
  usePanelDelay(sasCmd);
  usePanelDelay(rcsCmd);
  usePanelDelay(sasModeCmd);
  usePanelDelay(fbwCmd);

  // Trim has no readback to anchor a control stream, so it sends `setAxes` one field at a time, never clobbering a live axis.
  const trimCmd = useCommand("vessel.control.setAxes");
  usePanelDelay(trimCmd);
  const sendTrim = (
    field: "pitchTrim" | "yawTrim" | "rollTrim",
    raw: number,
  ) => {
    void trimCmd.send({ [field]: raw });
  };

  // Uncoerced: inverting an unread arm would be a blind guess, and an unread arm is not a confirmed OFF.
  const sasRaw = control?.sas;
  const rcsRaw = control?.rcs;

  const toggleSas = () => {
    if (typeof sasRaw !== "boolean") return;
    void sasCmd.send({ enabled: !sasRaw }, { label: "Toggle SAS" });
  };
  const toggleRcs = () => {
    if (typeof rcsRaw !== "boolean") return;
    void rcsCmd.send({ enabled: !rcsRaw }, { label: "Toggle RCS" });
  };
  const setSasMode = (mode: SasMode) => {
    void sasModeCmd.send(
      { mode: sasModeOrdinal(mode) },
      { label: `SAS mode: ${mode}` },
    );
  };

  /*
   * A failed mode command is echoed on the button that issued it, matched back
   * by the label `setSasMode` stamps; dismissing there or in the Panel queue
   * clears both.
   */
  const sasFailures = useCommandFailures(sasModeCmd);
  const failedSasModes = new Map<SasMode, string>();
  for (const f of sasFailures.failed) {
    const mode = SAS_MODES.find((m) => f.label === `SAS mode: ${m}`);
    if (mode) failedSasModes.set(mode, f.id);
  }

  // FBW has no readback, so its state mirrors the latest arm command; it disarms on unmount.
  const [fbwArmed, setFbwArmed] = useState(false);
  const fbwArmedRef = useRef(false);
  useEffect(() => {
    fbwArmedRef.current = fbwArmed;
  }, [fbwArmed]);
  useEffect(() => {
    return () => {
      if (fbwArmedRef.current) {
        void fbwCmd.send({ enabled: false }, { label: "Disarm FBW" });
      }
    };
  }, [fbwCmd.send]);

  const armFbw = () => {
    void fbwCmd.send({ enabled: true }, { label: "Arm FBW" });
    setFbwArmed(true);
  };
  const disarmFbw = () => {
    void fbwCmd.send({ enabled: false }, { label: "Disarm FBW" });
    setFbwArmed(false);
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

  // Buttons fire on the press edge only, so a hardware press-and-release does not trigger twice.
  useActionInput<NavballActions>({
    "take-control": (payload) => {
      if (!isButtonPress(payload)) return;
      onConfigChange?.({ ...(config ?? {}), controlMode: !controlMode });
    },
    "arm-fbw": (payload) => {
      if (!isButtonPress(payload)) return;
      armFbw();
    },
    "disarm-fbw": (payload) => {
      if (!isButtonPress(payload)) return;
      disarmFbw();
    },
    "toggle-sas": (payload) => {
      if (!isButtonPress(payload)) return;
      toggleSas();
    },
    "toggle-rcs": (payload) => {
      if (!isButtonPress(payload)) return;
      toggleRcs();
    },
    "toggle-precision": (payload) => {
      if (!isButtonPress(payload)) return;
      // A no-op: precision control has no set command, but the action keeps a mapping ready for one.
    },
    "kill-rotation": (payload) => {
      if (!isButtonPress(payload)) return;
      setSasMode("StabilityAssist");
    },
    "sas-stability": (p) => isButtonPress(p) && setSasMode("StabilityAssist"),
    "sas-prograde": (p) => isButtonPress(p) && setSasMode("Prograde"),
    "sas-retrograde": (p) => isButtonPress(p) && setSasMode("Retrograde"),
    "sas-normal": (p) => isButtonPress(p) && setSasMode("Normal"),
    "sas-antinormal": (p) => isButtonPress(p) && setSasMode("Antinormal"),
    "sas-radial-in": (p) => isButtonPress(p) && setSasMode("RadialIn"),
    "sas-radial-out": (p) => isButtonPress(p) && setSasMode("RadialOut"),
    "sas-target": (p) => isButtonPress(p) && setSasMode("Target"),
    "sas-anti-target": (p) => isButtonPress(p) && setSasMode("AntiTarget"),
    "sas-maneuver": (p) => isButtonPress(p) && setSasMode("Maneuver"),
    "set-throttle": (p) => {
      const v = analogValue(p, 0, 1);
      if (v !== null) setThrottleCmd(v);
    },
    "throttle-up": (p) =>
      isButtonPress(p) &&
      throttleKnown &&
      setThrottleCmd((v) => clamp(v + 0.1, 0, 1)),
    "throttle-down": (p) =>
      isButtonPress(p) &&
      throttleKnown &&
      setThrottleCmd((v) => clamp(v - 0.1, 0, 1)),
    "throttle-zero": (p) => isButtonPress(p) && setThrottleCmd(0),
    "throttle-full": (p) => isButtonPress(p) && setThrottleCmd(1),
    "set-pitch": (p) => {
      const v = analogValue(p, -1, 1);
      if (v !== null) setPitchCmd(v);
    },
    "set-yaw": (p) => {
      const v = analogValue(p, -1, 1);
      if (v !== null) setYawCmd(v);
    },
    "set-roll": (p) => {
      const v = analogValue(p, -1, 1);
      if (v !== null) setRollCmd(v);
    },
    "translate-x": (p) => {
      const v = analogValue(p, -1, 1);
      if (v !== null) setTranslateXCmd(v);
    },
    "translate-y": (p) => {
      const v = analogValue(p, -1, 1);
      if (v !== null) setTranslateYCmd(v);
    },
    "translate-z": (p) => {
      const v = analogValue(p, -1, 1);
      if (v !== null) setTranslateZCmd(v);
    },
    "set-pitch-trim": (p) => {
      const v = analogValue(p, -1, 1);
      if (v !== null) sendTrim("pitchTrim", v);
    },
    "set-yaw-trim": (p) => {
      const v = analogValue(p, -1, 1);
      if (v !== null) sendTrim("yawTrim", v);
    },
    "set-roll-trim": (p) => {
      const v = analogValue(p, -1, 1);
      if (v !== null) sendTrim("rollTrim", v);
    },
  });

  /**
   * The largest square dial the attitude column fits on both axes: the fit
   * itself, never clamped up to {@link MIN_DIAL_PX}, so a column too small says
   * so. 180 until a ResizeObserver reports.
   */
  const [dialFit, setDialFit] = useState(180);
  /** Whether the readout's three cells fit on one line; true until a ResizeObserver reports. */
  const [readoutAcross, setReadoutAcross] = useState(true);
  const throttleReservedRef = useRef(false);
  const controlModeRef = useRef(false);
  const dialObserverRef = useRef<ResizeObserver | null>(null);
  /**
   * A callback ref on the attitude column, which renders in both branches: a
   * ref on the dial would stop observing once the fit said no, and the dial
   * could never come back. Measuring the column also keeps the verdict from
   * flip-flopping, since the readout is far shorter than a dial needs.
   */
  const attachAttitude = useCallback((el: HTMLDivElement | null) => {
    dialObserverRef.current?.disconnect();
    dialObserverRef.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        const h = e.contentRect.height;
        if (w <= 0 || h <= 0) continue;
        // Reserved by tile width, not by the column's visibility, which rides `showDial` and would make the fit oscillate.
        const throttleReserve = throttleReservedRef.current ? 42 : 0;
        const fit = Math.min(w - throttleReserve, h - ATTITUDE_CHROME_PX);
        // Capped in control mode so the control surface keeps its room; 600 is where tick text blurs.
        const cap = controlModeRef.current ? 200 : 600;
        setDialFit(Math.min(cap, Math.floor(fit)));
        // The readout carries no throttle bar, so it gets the full width.
        setReadoutAcross(w >= READOUT_TRIPLE_PX);
      }
    });
    ro.observe(el);
    dialObserverRef.current = ro;
  }, []);

  // The control surface needs ~350px beyond the dial, so a smaller tile degrades control mode to a plain dial.
  const cols = w ?? 8;
  const rows = h ?? 11;
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
  const showControlSurface = controlMode && rows >= 18 && cols >= 7;
  // The ResizeObserver closure reads these refs.
  controlModeRef.current = showControlSurface;
  throttleReservedRef.current = cols >= 5;

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
                {showThrottleColumn && (
                  <div style={THROTTLE_COLUMN}>
                    <span style={THROTTLE_LABEL}>THR</span>
                    <div style={THROTTLE_BAR}>
                      {throttle !== null && (
                        <div
                          style={{
                            ...THROTTLE_FILL,
                            height: `${throttle * 100}%`,
                          }}
                        />
                      )}
                    </div>
                    <span style={THROTTLE_VAL}>
                      {throttle === null ? (
                        NULL_DISPLAY
                      ) : (
                        <Unit value={value("%", throttle * 100)} decimals={0} />
                      )}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div style={NUMERIC_READOUT}>
                <div style={readoutAcross ? READOUT_TRIPLE : READOUT_STACK}>
                  {attitudeCells(heading, pitch, roll).map((cell) =>
                    readoutAcross ? (
                      <BigReadout key={cell.label} style={READOUT_CELL}>
                        {cell.value}
                        <ReadoutCaption>{cell.label}</ReadoutCaption>
                      </BigReadout>
                    ) : (
                      <div key={cell.label} style={READOUT_PAIR}>
                        <span style={READOUT_LABEL}>{cell.label}</span>
                        <span style={READOUT_VALUE}>{cell.value}</span>
                      </div>
                    ),
                  )}
                </div>
                <AttitudeCurrency
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
              onDismissSasFailure={sasFailures.dismiss}
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
 * The numeric readout's three cells. Pitch and roll carry an explicit `+`, since
 * an unsigned `45` reads as a magnitude; heading is a bearing and takes no sign.
 */
function attitudeCells(
  heading: number | null,
  pitch: number | null,
  roll: number | null,
): ReadonlyArray<{ label: string; value: ReactNode }> {
  // One element, never a fragment: in the column-flex cell a bare sign would become its own flex item on its own line.
  const signed = (v: number | null): ReactNode => (
    <span>
      {v === null ? (
        NULL_DISPLAY
      ) : (
        <>
          {v >= 0 ? "+" : ""}
          <Unit value={value("°", v)} decimals={0} />
        </>
      )}
    </span>
  );
  return [
    {
      label: "HDG",
      value: (
        <span>
          {heading === null ? (
            NULL_DISPLAY
          ) : (
            <Unit value={value("°", heading)} decimals={0} />
          )}
        </span>
      ),
    },
    { label: "PCH", value: signed(pitch) },
    { label: "RLL", value: signed(roll) },
  ];
}

interface ControlTogglesProps {
  disabled: boolean;
  /** SAS as read, uncoerced: absent is a third state, not false. */
  sas: boolean | null | undefined;
  /** The active SAS mode's three-letter token, or `""` when no mode is on the wire. See {@link badgeSasMode}. */
  sasBadgeMode: string;
  /** RCS as read, uncoerced. */
  rcs: boolean | null | undefined;
  /** Precision control as read, uncoerced; the chip is absent until a reading lands. */
  precision: boolean | null | undefined;
  onToggleSas: () => void;
  onToggleRcs: () => void;
}

/**
 * SAS and RCS toggles plus a precision readout, on every tile wide enough, not
 * only in control mode. The SAS toggle carries the active mode, since on a tile
 * too small for the mode grid it is the only place the mode appears. Precision
 * has no set command, so it is a readout.
 */
function ControlToggles({
  disabled,
  sas,
  sasBadgeMode,
  rcs,
  precision,
  onToggleSas,
  onToggleRcs,
}: ControlTogglesProps) {
  return (
    <>
      {disabled && (
        <div style={BANNER} role="status" aria-live="polite">
          Vessel not controllable: buttons disabled.
        </div>
      )}
      <div style={TOGGLE_ROW}>
        <ToggleButton
          type="button"
          size="sm"
          style={TOGGLE_CELL}
          active={sas === true}
          onClick={onToggleSas}
          disabled={disabled}
        >
          {armLabel("SAS", sas, sasBadgeMode)}
        </ToggleButton>
        <ToggleButton
          type="button"
          size="sm"
          style={TOGGLE_CELL}
          active={rcs === true}
          onClick={onToggleRcs}
          disabled={disabled}
        >
          {armLabel("RCS", rcs)}
        </ToggleButton>
        {/* A dim chip means off, so there is no chip until precision is read. */}
        {typeof precision === "boolean" && (
          <ToggleButton
            type="button"
            size="sm"
            style={TOGGLE_CELL}
            active={precision}
            disabled
          >
            PRECISION
          </ToggleButton>
        )}
      </div>
    </>
  );
}

/**
 * One arm's toggle label: `SAS: PRO` / `RCS ON` when on, `SAS OFF` when
 * confirmed off, and the name plus `NULL_DISPLAY` when unread. Not the bare
 * name, which would collide with the mode grid's "SAS" stability-assist button.
 */
function armLabel(
  name: string,
  on: boolean | null | undefined,
  mode?: string,
): string {
  if (on !== true && on !== false) return `${name} ${NULL_DISPLAY}`;
  if (!on) return `${name} OFF`;
  return mode ? `${name}: ${mode}` : `${name} ON`;
}

interface ControlSurfaceProps {
  disabled: boolean;
  sasMode: string | null;
  /** Commanded throttle (0..1), tracking the readback until touched; `null` while there is neither. */
  throttleCmd: number | null;
  onSetThrottleCmd: (next: number | ((v: number) => number)) => void;
  throttleStream: ControlStream;
  /** The fly-by-wire attitude and translation streams, drawn on the same delay graph as the throttle. */
  axisStreams: ControlStream[];
  fbwArmed: boolean;
  onArmFbw: () => void;
  onDisarmFbw: () => void;
  onSetSasMode: (mode: SasMode) => void;
  /** SAS modes whose command is overdue or lost, mapped to that command's id so the button can dismiss it. */
  failedSasModes: Map<SasMode, string>;
  onDismissSasFailure: (id: string) => void;
  showFbwDelayWarning: boolean;
  delaySeconds: number | null;
}

function ControlSurface({
  disabled,
  sasMode,
  throttleCmd,
  onSetThrottleCmd,
  throttleStream,
  axisStreams,
  fbwArmed,
  onArmFbw,
  onDisarmFbw,
  onSetSasMode,
  failedSasModes,
  onDismissSasFailure,
  showFbwDelayWarning,
  delaySeconds,
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
          <input
            type="range"
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
            active={fbwArmed}
            onClick={fbwArmed ? onDisarmFbw : onArmFbw}
            disabled={disabled}
          >
            {fbwArmed ? "FBW ARMED" : "Arm FBW"}
          </ToggleButton>
          <span style={FBW_HINT}>
            {fbwArmed ? "Stick inputs live" : "Stick inputs off"}
          </span>
        </div>
        {showFbwDelayWarning && delaySeconds !== null && (
          <StatusIndicator tone="warn">
            <span role="status" aria-live="polite">
              High signal delay
            </span>{" "}
            (<Countdown value={delaySeconds} precise />
            ): stick input lands one round trip late
          </StatusIndicator>
        )}
      </div>
    </div>
  );
}

function modeShort(mode: SasMode): string {
  switch (mode) {
    case "StabilityAssist":
      return "SAS";
    case "Prograde":
      return "PRO";
    case "Retrograde":
      return "RET";
    case "Normal":
      return "NOR";
    case "Antinormal":
      return "ANT";
    case "RadialIn":
      return "RIN";
    case "RadialOut":
      return "ROU";
    case "Target":
      return "TGT";
    case "AntiTarget":
      return "ATG";
    case "Maneuver":
      return "MNV";
  }
}

/**
 * The SAS toggle's mode token, the same three letters as the mode grid.
 * StabilityAssist reads "SAS: SAS" on purpose: dropping the suffix would match
 * the label for no mode on the wire. `Unknown` keeps its name, since a "?" would
 * look like a rendering fault.
 */
function badgeSasMode(mode: SasModeName): string {
  return mode === "Unknown" ? mode : modeShort(mode);
}

/** An analog input clamped to the axis, or `null` when not finite: a NaN read as 0 would cut the engine. */
function analogValue(
  p: { kind: string; value: unknown },
  lo: number,
  hi: number,
): number | null {
  if (p.kind !== "analog") return null;
  if (typeof p.value !== "number" || !Number.isFinite(p.value)) return null;
  return clamp(p.value, lo, hi);
}

function isButtonPress(p: { kind: string; value: unknown }): boolean {
  return p.kind === "button" && p.value === true;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** An attitude angle's magnitude, whether it arrives as a bare number or a quantity. */
function numericOrNull(v: unknown): number | null {
  return magnitudeOf(asQuantityish(v));
}

function NavballConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<NavballConfig>>) {
  const [useCoMFrame, setUseCoMFrame] = useState(config?.useCoMFrame === true);
  const [controlMode, setControlMode] = useState(config?.controlMode === true);

  const candidate = useMemo<NavballConfig>(
    () => ({ useCoMFrame, controlMode }),
    [useCoMFrame, controlMode],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel>Display surface</FieldLabel>
        <Select
          value={controlMode ? "control" : "display"}
          onChange={(e) => setControlMode(e.target.value === "control")}
        >
          <option value="display">Display only: read attitude</option>
          <option value="control">Control mode: buttons + FBW</option>
        </Select>
        <FieldHint>
          Control mode adds SAS-mode buttons, throttle controls, and an FBW
          arm/disarm switch. The display still updates either way; the action
          surface is also available for serial mappings regardless.
        </FieldHint>
      </Field>
      <Field>
        <Switch
          checked={useCoMFrame}
          onChange={setUseCoMFrame}
          label="Read from centre-of-mass frame"
        />
        <FieldHint>
          Default reads from the root part's own orientation. Switch on for
          vessels where the probe core / command pod isn't aligned with the
          ship's geometry.
        </FieldHint>
      </Field>
    </ConfigForm>
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

/**
 * HDG, PCH and RLL on one line, each reading over its caption. Never `auto-fit`
 * or a wrap, which would make the arity depend on digit count: the row is
 * always three across or, under {@link READOUT_TRIPLE_PX}, {@link READOUT_STACK}.
 */
const READOUT_TRIPLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "var(--gap-related)",
};

/** One reading per line as label-beside-value pairs, 85px tall where stacked cells would need 136. */
const READOUT_STACK: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
};

/**
 * Makes a `BigReadout` one of three in a row. Its own font size follows the
 * viewport, not the tile, so it takes the stacked readout's size instead; its
 * zeroed `min-width` would let the `1fr` columns collapse; `nowrap` keeps a
 * sign on the same line as its number.
 */
const READOUT_CELL: CSSProperties = {
  fontSize: "var(--font-size-figure)",
  minWidth: "auto",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const READOUT_PAIR: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--gap-related)",
};

const READOUT_LABEL: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  color: "var(--color-text-faint)",
};

const READOUT_VALUE: CSSProperties = {
  fontSize: "var(--font-size-figure)",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "0.04em",
};

const THROTTLE_COLUMN: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--gap-related)",
  minWidth: "32px",
};

const THROTTLE_LABEL: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  color: "var(--color-text-faint)",
};

const THROTTLE_BAR: CSSProperties = {
  width: "14px",
  height: "100px",
  border: "1px solid var(--color-surface-raised)",
  background: "var(--color-surface-app)",
  position: "relative",
  overflow: "hidden",
};

const THROTTLE_FILL: CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  background: "var(--color-accent-fg)",
  // Off the motion scale: an 80ms chase of live throttle must not move when the UI motion tokens are retuned.
  transition: "height 80ms linear",
};

const THROTTLE_VAL: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
};

const CONTROL_WRAP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  paddingTop: "var(--inset-below-rule)",
  borderTop: "1px solid var(--color-surface-raised)",
};

const BANNER: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-status-warning-bg)",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-status-warning-bg)",
  borderRadius: "var(--radius-regular)",
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

/** The SAS/RCS/precision row, packed by each control's own width rather than a uniform column minimum. */
const TOGGLE_ROW: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
};

// Never shrinks: an inline-flex button's minimum is its widest word, so shrinking breaks or overflows the label before the row wraps.
const TOGGLE_CELL: CSSProperties = { flex: "1 0 auto" };

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
  configComponent: NavballConfigComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: { useCoMFrame: false, controlMode: false },
  actions: navballActions,
  pushable: true,
  requires: ["flight"],
});

export { NavballComponent };
