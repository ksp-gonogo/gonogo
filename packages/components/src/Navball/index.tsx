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
  readingOf,
  SAS_MODE_NAMES,
  stillTrue,
  type TinyEssential,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Countdown,
  derivedMarking,
  Panel,
  Section,
  TinyEssentials,
  useRailEntry,
} from "@ksp-gonogo/ui-kit";
import { type CSSProperties, useMemo, useState } from "react";
import { magnitudeOf } from "../shared/magnitude";
import { AppliedInput } from "./AppliedInput";
import { AttitudeIndicator } from "./AttitudeIndicator";
import { AttitudeReadout } from "./AttitudeReadout";
import { ControlSurface, FBW_VIEW } from "./ControlSurface";
import { ControlToggles } from "./ControlToggles";
import { type NavballConfig, navballActions } from "./config";
import { useAxisStreams, useThrottleCommand } from "./controlStreams";
import { FbwBanner } from "./FbwBanner";
import { NavballConfigForm } from "./NavballConfigForm";
import read from "./navball.declarations.g";
import { lastObserved, numericOrNull } from "./readings";
import { badgeSasMode } from "./sasModes";
import { ThrottleGauge } from "./ThrottleGauge";
import { useTrimSender } from "./trimCoalescer";
import {
  ATTITUDE_CHROME_PX,
  CONTROL_DIAL_CAP_PX,
  MIN_DIAL_PX,
  useDialFit,
} from "./useDialFit";
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
  optionalChannels: read.optionalChannels,
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
    "vessel.control.flyByWire",
    "vessel.control.throttle",
    "vessel.control.pitch",
    "vessel.control.roll",
    "vessel.comms.controlState",
    "comms.delay.oneWaySeconds",
    "vessel.identity.vesselId",
  ],
});

/**
 * One-way delay above which armed fly-by-wire warns: the felt loop lag is about
 * twice one-way, and past 2s round-trip closed-loop stick flying stops working.
 */
const FBW_DELAY_WARN_SECONDS = 1.0;

/** Grid rows from which the control surface opens, with its SAS mode and throttle sections folded. */
const CONTROL_SURFACE_ROWS = 13;

const TRIM_LABELS: Record<TrimField, string> = {
  pitchTrim: "Pitch trim",
  yawTrim: "Yaw trim",
  rollTrim: "Roll trim",
};

/**
 * Everything the navball reads and every input it binds, shared by the body and
 * the tiny form so a bound key or stick keeps working at either size.
 */
function useNavball({
  config,
  onConfigChange,
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
  const controlReading = topics.useTelemetry("vessel.control");
  const control = lastObserved(controlReading);
  // The game keeps reporting the last mode while SAS is off, and a pressed mode beside SAS OFF reads as a contradiction.
  const sasMode =
    control?.sas === false
      ? undefined
      : enumNameOf<SasModeName>(SAS_MODE_NAMES, control?.sasMode);
  const availableSasModes = control?.sasModesAvailable
    ? new Set(
        control.sasModesAvailable.flatMap((m) => {
          const name = enumNameOf<SasModeName>(SAS_MODE_NAMES, m);
          return name && name !== "Unknown" ? [name] : [];
        }),
      )
    : null;
  const sasBadgeMode = sasMode ? badgeSasMode(sasMode) : "";
  const throttle = magnitudeOf(control?.throttle);
  // Only a confirmed `*None` control state disables the buttons: greying out the stick is a claim about the craft.
  const comms = lastObserved(topics.useTelemetry("vessel.comms"));
  const controlLevel =
    comms === undefined
      ? undefined
      : collapseControlStateLevel(comms.controlState);
  const isControllable = controlLevel === undefined || controlLevel > 0;

  const {
    throttleCmd,
    setThrottleCmd,
    throttleBase,
    throttleExpected,
    throttleKnown,
    throttleStream,
  } = useThrottleCommand(throttle);
  const { axisStreams, setAxis } = useAxisStreams();

  const {
    sasRaw,
    sasUnavailableReason,
    rcsRaw,
    precisionRaw,
    sasButton,
    rcsButton,
    precisionButton,
    sasCmd,
    rcsCmd,
    precisionCmd,
    toggleSas,
    engageSas,
    toggleRcs,
    togglePrecision,
    setSasMode,
    sasModeCommand,
  } = useSasControls(
    control,
    derivedMarking(controlReading) !== null,
    sasBadgeMode,
    derivedMarking(controlReading),
    isControllable,
  );
  const identity = stillTrue(topics.useTelemetry("vessel.identity"), undefined);
  const {
    fbwState,
    armFbw,
    disarmFbw,
    armFbwCommand,
    disarmFbwCommand,
    disarmFbwToggle,
  } = useFlyByWire(identity?.vesselId, control?.flyByWire ?? undefined);

  // Trim has no readback to anchor a control stream, so it sends `setAxes` one field at a time, never clobbering a live axis.
  const trimCmd = useCommand("vessel.control.setAxes");
  const sendTrim = useTrimSender((field: TrimField, raw: number) => {
    void trimCmd.dangerouslySendWithoutInput(
      { [field]: raw },
      { label: TRIM_LABELS[field] },
    );
  });

  /*
   * `oneWaySeconds` is 0 with the delay feature off. Read as last-observed: a
   * craft whose delay reading went quiet has not stopped being far away.
   */
  const oneWayDelay = useTelemetry("comms.delay").oneWaySeconds;
  const delaySeconds = magnitudeOf(
    oneWayDelay.state === "observed" || oneWayDelay.state === "held"
      ? oneWayDelay.value
      : undefined,
  );
  const delayHigh =
    delaySeconds !== null && delaySeconds > FBW_DELAY_WARN_SECONDS;
  const showFbwDelayWarning = fbwState !== "off" && delayHigh;

  useNavballInputs({
    toggleControlMode: () =>
      onConfigChange?.({ ...(config ?? {}), controlMode: !controlMode }),
    armFbw,
    disarmFbw,
    toggleSas,
    engageSas,
    toggleRcs,
    togglePrecision,
    setSasMode,
    setThrottleCmd,
    throttleKnown,
    setAxis,
    sendTrim,
  });

  return {
    controlMode,
    heading,
    pitch,
    roll,
    attitudeReading,
    attitudeObserved,
    controlReading,
    control,
    sasMode,
    availableSasModes,
    sasBadgeMode,
    throttle,
    isControllable,
    throttleCmd,
    setThrottleCmd,
    throttleBase,
    throttleExpected,
    throttleKnown,
    throttleStream,
    axisStreams,
    sasRaw,
    sasUnavailableReason,
    rcsRaw,
    precisionRaw,
    sasButton,
    rcsButton,
    precisionButton,
    sasCmd,
    rcsCmd,
    precisionCmd,
    toggleSas,
    toggleRcs,
    togglePrecision,
    setSasMode,
    sasModeCommand,
    fbwState,
    armFbwCommand,
    disarmFbwCommand,
    disarmFbwToggle,
    showFbwDelayWarning,
    delaySeconds,
    oneWayDelay,
  };
}

/** Heading, pitch and roll as the figures of the tiny form, each drawn off the attitude's own reading so a held one is marked. */
function useNavballEssentials(
  props: Readonly<ComponentProps<NavballConfig>>,
): readonly TinyEssential[] {
  return navballEssentials(useNavball(props));
}

function navballEssentials({
  heading,
  pitch,
  roll,
  attitudeReading,
  fbwState,
  disarmFbwToggle,
}: Pick<
  ReturnType<typeof useNavball>,
  | "heading"
  | "pitch"
  | "roll"
  | "attitudeReading"
  | "fbwState"
  | "disarmFbwToggle"
>): readonly TinyEssential[] {
  const degrees = (angle: number | null) =>
    angle === null ? null : readingOf(attitudeReading, () => value("°", angle));
  const fbw = FBW_VIEW[fbwState];
  return [
    ...(fbwState === "off"
      ? []
      : [
          {
            label: "FBW",
            control: {
              label: fbw.label,
              active: fbwState === "armed",
              title: "Disarm fly-by-wire",
              hint: `${fbw.hint}. Press to disarm`,
              command: disarmFbwToggle,
            },
          },
        ]),
    { label: "HDG", value: degrees(heading), decimals: 0 },
    { label: "PCH", value: degrees(pitch), decimals: 0, signed: true },
    { label: "RLL", value: degrees(roll), decimals: 0, signed: true },
  ];
}

function NavballComponent(props: Readonly<ComponentProps<NavballConfig>>) {
  const { w, h } = props;
  const navball = useNavball(props);
  // The component stays mounted at the tiny size so commands in flight survive a resize.
  const tiny =
    w !== undefined &&
    h !== undefined &&
    (w < NAVBALL_MIN_SIZE.w || h < NAVBALL_MIN_SIZE.h);
  const {
    controlMode,
    heading,
    pitch,
    roll,
    attitudeReading,
    attitudeObserved,
    controlReading,
    control,
    sasMode,
    availableSasModes,
    sasBadgeMode,
    throttle,
    isControllable,
    throttleCmd,
    setThrottleCmd,
    throttleBase,
    throttleExpected,
    throttleStream,
    axisStreams,
    sasRaw,
    sasUnavailableReason,
    rcsRaw,
    precisionRaw,
    sasButton,
    rcsButton,
    precisionButton,
    sasCmd,
    rcsCmd,
    precisionCmd,
    sasModeCommand,
    fbwState,
    armFbwCommand,
    disarmFbwCommand,
    disarmFbwToggle,
    showFbwDelayWarning,
    delaySeconds,
    oneWayDelay,
  } = navball;

  /*
   * The throttle and the fly-by-wire axes are held controls, so the panel's
   * delay rail draws them as one graph. An axis is on the rail from the moment
   * it is first commanded, and the rail has no entry at all while none has been.
   * A warning is only ever given for an input someone sent, so it counts. The
   * readback is sampled whether or not anything was commanded, so it says
   * nothing here.
   */
  const railStreams = useMemo(
    () =>
      [throttleStream, ...axisStreams].filter(
        (s) =>
          s.current !== null || s.inTransit.length > 0 || s.warnings.length > 0,
      ),
    [throttleStream, axisStreams],
  );
  const railEntry = useMemo(
    () =>
      controlMode && !tiny && railStreams.length > 0
        ? {
            inFlight: [],
            tags: throttleStream.tags,
            effectiveDelaySeconds: delaySeconds,
            delayReading: oneWayDelay,
            streams: railStreams,
            warnings: railStreams.flatMap((s) => s.warnings),
            "aria-label": "Navball: controls in flight",
          }
        : null,
    [
      controlMode,
      tiny,
      throttleStream.tags,
      delaySeconds,
      oneWayDelay,
      railStreams,
    ],
  );
  useRailEntry(railEntry);

  // The control surface needs ~350px beyond the dial, so a smaller tile degrades control mode to a plain dial.
  const cols = w ?? 8;
  const rows = h ?? 11;
  const showControlSurface =
    controlMode && rows >= CONTROL_SURFACE_ROWS && cols >= 7;
  const gridWantsDial = rows >= 6 && cols >= 4;
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const {
    dialFit,
    readoutAcross,
    columnWidth,
    columnHeight,
    showControlRow,
    attachAttitude,
    attachControlRow,
  } = useDialFit({
    reserveThrottle: cols >= 5,
    controlSurface: showControlSurface,
    controlRowWanted: cols >= 5 && rows >= CONTROL_ROW_MIN_ROWS,
    dialPossible: gridWantsDial && attitudeObserved,
    held: sectionsOpen && showControlSurface,
  });
  /*
   * Grid units say whether a dial is wanted; the measured fit says whether one
   * will go. The dial draws only off an observed attitude: a held one is
   * indistinguishable from a live one, and attitude cannot be reckoned forward,
   * since torque from SAS or an in-flight command changes it.
   */
  const dialWanted = gridWantsDial && dialFit >= MIN_DIAL_PX;
  const showDial = dialWanted && attitudeObserved;
  const showThrottleColumn = showDial && cols >= 5;
  // Armed with the control surface out of sight (control mode off, or a small tile), the override still says so and can be dropped.
  const fbwOutsideSurface = fbwState !== "off" && !showControlSurface;
  // Under the stacked readout's own floor the figures take one fixed-width line each. A column too narrow for three across stacks them, and five rows cannot hold that stack under the title.
  const compactReadout = rows < 5 || (rows < 6 && !readoutAcross);

  if (tiny) {
    return (
      <TinyEssentials
        title={NAVBALL_TINY.title}
        essentials={navballEssentials(navball)}
        equalRows={NAVBALL_TINY.equalRows}
      />
    );
  }

  return (
    <Panel
      panelTitle="NAVBALL"
      fitToSize={compactReadout}
      hoverTitle={compactReadout}
      sections={[
        <Section
          key="attitude"
          fill
          {...(showControlSurface
            ? {
                style:
                  sectionsOpen && columnHeight > 0
                    ? HELD_ATTITUDE
                    : CONTROL_ATTITUDE,
              }
            : showDial
              ? {}
              : { style: READOUT_FLOOR })}
        >
          <div
            ref={attachAttitude}
            style={
              showControlSurface && sectionsOpen && columnHeight > 0
                ? { ...ATTITUDE_COLUMN, flex: "none", height: columnHeight }
                : ATTITUDE_COLUMN
            }
          >
            {showDial ? (
              <div style={DIAL_WRAP}>
                <AttitudeIndicator
                  heading={heading}
                  pitch={pitch}
                  roll={roll}
                  size={dialFit}
                />
                {showThrottleColumn && (
                  <ThrottleGauge throttle={throttle} reading={controlReading} />
                )}
              </div>
            ) : (
              <div
                style={
                  compactReadout
                    ? { ...NUMERIC_READOUT, gap: "var(--gap-related-packed)" }
                    : NUMERIC_READOUT
                }
              >
                <AttitudeReadout
                  heading={heading}
                  pitch={pitch}
                  roll={roll}
                  across={readoutAcross}
                  columnWidth={columnWidth}
                  compact={compactReadout}
                  reading={attitudeReading}
                />
                {/* Inside the readout's own section, since a compact tile has no room for the gap and inset of a section of its own. */}
                {fbwOutsideSurface && compactReadout && (
                  <FbwBanner
                    fbwState={fbwState}
                    disarm={disarmFbwCommand}
                    compact
                  />
                )}
              </div>
            )}
          </div>
        </Section>,
        showControlRow || (fbwOutsideSurface && !compactReadout) ? (
          <Section key="controls" full>
            {fbwOutsideSurface && !compactReadout && (
              <FbwBanner fbwState={fbwState} disarm={disarmFbwCommand} />
            )}
            {showControlRow && (
              <div ref={attachControlRow} style={CONTROL_ROW}>
                <AppliedInput
                  pitch={control?.pitch}
                  roll={control?.roll}
                  reading={controlReading}
                />
                <ControlToggles
                  disabled={!isControllable}
                  sas={{ control: sasButton, handle: sasCmd }}
                  rcs={{ control: rcsButton, handle: rcsCmd }}
                  precision={
                    typeof precisionRaw === "boolean"
                      ? { control: precisionButton, handle: precisionCmd }
                      : null
                  }
                  sasUnavailableReason={sasUnavailableReason}
                />
              </div>
            )}
          </Section>
        ) : null,
        showControlSurface ? (
          <Section key="control">
            <ControlSurface
              disabled={!isControllable}
              sasMode={sasMode ?? null}
              availableSasModes={availableSasModes}
              throttleBase={throttleBase}
              throttleExpected={throttleExpected}
              throttleLastSeen={
                throttle !== null && controlReading.state !== "observed"
                  ? {
                      value: throttle,
                      caption:
                        derivedMarking(controlReading)?.caption ??
                        "last reported",
                    }
                  : null
              }
              onSetThrottleCmd={setThrottleCmd}
              fbwState={fbwState}
              armFbwCommand={armFbwCommand}
              disarmFbwCommand={disarmFbwCommand}
              sasModeCommand={sasModeCommand}
              showFbwDelayWarning={showFbwDelayWarning}
              delaySeconds={delaySeconds}
              oneWayDelay={oneWayDelay}
              onSectionsOpenChange={setSectionsOpen}
            />
          </Section>
        ) : null,
        showControlSurface ? (
          <Section key="spare" fill style={SPARE_ROOM} />
        ) : null,
      ]}
      /* The aside carries alerts only; control state lives in the body. */
      panelAside={
        showFbwDelayWarning && delaySeconds !== null ? (
          <Badge tone="warn" size="sm">
            FBW · <Countdown value={oneWayDelay} precise /> DELAY
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
 * way back to a dial. Its own minimum height is dropped, since the filling
 * section's default floor is taller than the readout and would push a short
 * tile past its body.
 */
const READOUT_FLOOR: CSSProperties = { flexShrink: 0, minHeight: 0 };

/*
 * With the control surface out, the dial takes the room it can use (its capped
 * size plus the readout under it) and no more, and a spare section after the
 * surface takes what is left. The controls then sit from the top of the tile,
 * so opening a folded section or arming fly-by-wire grows into spare room below
 * them and moves nothing above; a tile too short to spare any room gives the
 * room up from the dial.
 */
const CONTROL_ATTITUDE: CSSProperties = {
  flex: `0 1 ${CONTROL_DIAL_CAP_PX + ATTITUDE_CHROME_PX}px`,
};

/**
 * The attitude section while a section below it is open: it keeps the height
 * it had folded, so the dial, the figures and the rows above the open section
 * stay put and the panel body scrolls to the rest.
 */
const HELD_ATTITUDE: CSSProperties = { flex: "0 0 auto", minHeight: 0 };

/** The room left under the control surface, which holds nothing and so has no floor of its own. */
const SPARE_ROOM: CSSProperties = { minHeight: 0 };

/** The shortest tile, in rows, that holds the readout and the SAS and RCS row together without scrolling. */
const CONTROL_ROW_MIN_ROWS = 8;

/** The control row's measured box: the same stack the section would have made of its children. */
const CONTROL_ROW: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-rows)",
};

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

const NAVBALL_TINY = {
  title: "NAVBALL",
  bindsActions: true,
  staysMounted: true,
  equalRows: true,
  useEssentials: useNavballEssentials,
} as const;

// Below four columns or three rows the tile shows the tiny form.
const NAVBALL_MIN_SIZE = { w: 4, h: 3 } as const;

registerComponent<NavballConfig>({
  id: "navball",
  name: "Navball",
  description:
    "Your vessel's heading, pitch and roll, with optional flight controls.",
  tags: ["telemetry", "control"],
  // Fifteen rows hold the control surface with its sections folded beside a dial as large as the plain default gives.
  defaultSize: { w: 8, h: 15 },
  // The control surface needs seven columns, which a half-width list tile does not reach.
  mobileWidth: "full",
  // Below four columns the three figures are the tiny form's, with the title behind a hover.
  minSize: NAVBALL_MIN_SIZE,
  component: NavballComponent,
  tiny: NAVBALL_TINY,
  configComponent: NavballConfigForm,
  channels: topics.channels,
  ...read,
  // The attitude reckoning subscribes the orbit with no read the scan can see.
  optionalChannels: [...read.optionalChannels, "vessel.orbit"],
  fields: topics.fields,
  defaultConfig: { useCoMFrame: false, controlMode: false },
  actions: navballActions,
  pushable: true,
  requires: ["flight"],
});

export { NavballComponent };
