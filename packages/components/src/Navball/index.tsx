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
  type Reading,
  useCommand,
  useControlStream,
  useStream,
  useViewUt,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { SasMode as SasModeEnum, value } from "@ksp-gonogo/sitrep-sdk";
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
import {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "../shared/magnitude";
import { AttitudeIndicator } from "./AttitudeIndicator";

const topics = defineTopicManifest({
  channels: [
    "vessel.attitude",
    "vessel.state",
    "vessel.control",
    "comms.delay",
  ],
  fields: [
    "vessel.attitude.heading",
    "vessel.attitude.pitch",
    "vessel.attitude.roll",
    "vessel.attitude.headingRootFrame",
    "vessel.attitude.pitchRootFrame",
    "vessel.attitude.rollRootFrame",
    "vessel.state.sasModeName",
    "vessel.control.sas",
    "vessel.control.precisionControl",
    "vessel.control.rcs",
    "vessel.control.throttle",
    "vessel.state.isControllable",
    "comms.delay.oneWaySeconds",
  ],
});

/**
 * Warn once one-way signal delay crosses this threshold AND fly-by-wire is
 * armed. The felt control-loop lag is ~2x one-way (command out + result
 * back), so 1s one-way ≈ 2s round-trip, the point past which closed-loop
 * stick flying stops working. Below that FBW is sloppy but usable; holding
 * the warning here avoids nuisance flashes on sub-second LAN jitter. `1.0`
 * mirrors the ms-below-1s breakpoint the shared duration ladder behind `Unit`
 * uses, an already-meaningful threshold in this codebase, tunable here if a
 * live session says otherwise.
 */
const FBW_DELAY_WARN_SECONDS = 1.0;

/**
 * The smallest dial worth drawing. Below it the ball is illegible and the
 * numeric readout is the better rendering of the same three angles, which is
 * why the widget has one at all.
 *
 * A floor on WHETHER to draw, never on what size to draw at. As a size clamp it
 * did the opposite of what it reads like: a column of 91px still got an 80px
 * dial, and the indicator overflowed it by 63.
 */
const MIN_DIAL_PX = 80;

/**
 * What `AttitudeIndicator` puts BELOW the dial in the same column: the heading
 * strip, the HDG/PIT/ROL readout row, and the two gaps between the three.
 *
 * A measured constant rather than a chosen one, so it moves when that column
 * does. It is also the reason a dial cannot simply shrink to whatever height
 * is left: the indicator is never shorter than this, so a column under
 * `MIN_DIAL_PX + ATTITUDE_CHROME_PX` holds no dial at all.
 */
const ATTITUDE_CHROME_PX = 74;

/**
 * The width the numeric readout needs to put HDG, PCH and RLL on one line.
 *
 * Three times the widest CELL plus two `--gap-related` gaps, because the three
 * columns are equal: 58px is what a cell measures at the widest reading any of
 * the three can carry (roll's `-180°`; heading's `359°` and pitch's `-90°` are
 * 47), so the sum of three different readings is not the number, and no fixture
 * puts all three at their own maximum at once. Sized to a fixture instead, the
 * row would change shape as the vessel rolled, which is what the wrap it
 * replaces did.
 *
 * 190 does not fit a 5-column tile's 158px column, and no template makes it:
 * three readings at this size need 190 and the tile has 158. That tier gets
 * {@link READOUT_STACK}.
 *
 * Stable against the coarse-pointer type bump, deliberately: the cell's width
 * is governed by its reading, and that is a literal 18px, not a token. The
 * caption under it is the token half and is narrower than the reading.
 *
 * The alternative to a number here is a container query, which an inline style
 * object cannot carry, and a uniform column minimum, which cannot express
 * "three or one" at all: every minimum wide enough to refuse a cramped
 * three-across leaves a band of widths where exactly two fit. See
 * {@link READOUT_TRIPLE}. Below this the grid OVERFLOWS rather than clipping,
 * so a cell that outgrows the number shows up in the harness's overlap gate
 * instead of quietly truncating a reading.
 */
const READOUT_TRIPLE_PX = 190;

/**
 * Dispatch-rate budget for the throttle axis's delayed control-stream
 * (`useControlStream`'s coalesced write half, `COALESCE_MS` in
 * `use-control-stream.tsx`, currently 10 Hz). `@ksp-gonogo/sitrep-client`
 * deliberately does not depend on `@ksp-gonogo/core` (core already depends
 * on sitrep-client, so the reverse would cycle), so the budget lives here
 * in the consuming widget and is wired in via the hook's `onDispatch` seam,
 * the same pattern `SitrepTelemetryProvider` uses for its own stream budget.
 * Threshold is ~5x the realistic steady-state ceiling (one axis, one widget
 * instance, 10 Hz) so a genuine runaway (e.g. a deadband regression that
 * dispatches every tick from multiple mounted instances) still trips it.
 */
const CONTROL_STREAM_BUDGET = new PerfBudget({
  name: "Navball control-stream dispatch/sec",
  threshold: 60,
  windowMs: 1000,
  unit: "dispatches",
});

/**
 * The SAS modes the grid offers a button for: every `Sitrep.Contract.SasMode`
 * member except `Unknown`, which is the contract's graceful fallback for a mode
 * this build cannot name and never something an operator asks for.
 *
 * Typed as member names rather than as bare strings, so an entry that is not a
 * real member does not compile, and `sasModeOrdinal.test.ts` fails if the list
 * stops covering the enum. The ORDER here is the grid's layout and nothing
 * else, never the wire ordinal via `indexOf`: doubled up that way, a member
 * inserted into the C# enum becomes a mis-command rather than a missing button.
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

/**
 * The navball glyph for each SAS mode that names a DIRECTION.
 *
 * `StabilityAssist` is absent on purpose rather than by omission: it holds the
 * attitude you already have, so there is no marker on the ball it corresponds
 * to and inventing one would say the craft is being pointed somewhere.
 */
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

/**
 * The wire ordinal for one SAS mode, read off the generated enum itself rather
 * than counted out of {@link SAS_MODES}. The button list is a layout; the
 * contract is the authority on which integer means which mode.
 */
export function sasModeOrdinal(mode: SasMode): number {
  return SasModeEnum[mode];
}

export { SAS_MODES };

interface NavballConfig {
  /** When true, read the CoM-referenced attitude frame (`heading`/`pitch`/`roll`). Default false reads the root-part-referenced frame (`headingRootFrame`/`pitchRootFrame`/`rollRootFrame`); the component body's ternary reads "backwards" relative to these names on purpose, see its comment. */
  useCoMFrame?: boolean;
  /** When true, render the control surface; otherwise show display-only. */
  controlMode?: boolean;
}

/**
 * Action surface, kept verbose so each axis and each mode is independently
 * mappable to a hardware input. The order matches the visible button rows, so
 * an operator reading the mapping list sees the same sequence as the panel.
 */
const navballActions = [
  // Mode + arm
  { id: "take-control", label: "Toggle control mode", accepts: ["button"] },
  { id: "arm-fbw", label: "Arm FBW", accepts: ["button"] },
  { id: "disarm-fbw", label: "Disarm FBW", accepts: ["button"] },
  // SAS
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
  // Throttle
  { id: "set-throttle", label: "Set throttle", accepts: ["analog"] },
  { id: "throttle-up", label: "Throttle up 10%", accepts: ["button"] },
  { id: "throttle-down", label: "Throttle down 10%", accepts: ["button"] },
  { id: "throttle-zero", label: "Throttle zero", accepts: ["button"] },
  { id: "throttle-full", label: "Throttle full", accepts: ["button"] },
  // FBW axes
  { id: "set-pitch", label: "Pitch axis", accepts: ["analog"] },
  { id: "set-yaw", label: "Yaw axis", accepts: ["analog"] },
  { id: "set-roll", label: "Roll axis", accepts: ["analog"] },
  { id: "translate-x", label: "RCS X", accepts: ["analog"] },
  { id: "translate-y", label: "RCS Y", accepts: ["analog"] },
  { id: "translate-z", label: "RCS Z", accepts: ["analog"] },
  // Trim
  { id: "set-pitch-trim", label: "Pitch trim", accepts: ["analog"] },
  { id: "set-yaw-trim", label: "Yaw trim", accepts: ["analog"] },
  { id: "set-roll-trim", label: "Roll trim", accepts: ["analog"] },
] as const satisfies readonly ActionDefinition[];

type NavballActions = typeof navballActions;

/**
 * The last REAL observation behind a reading, or nothing where there has not
 * been one. Never a modelled value; see `showDial`'s comment for why an attitude
 * is not forward-modellable at all.
 */
function lastObserved<T>(reading: Reading<T>): T | undefined {
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
 *
 * `dialSuppressed` distinguishes the two reasons the numeric readout can be on
 * screen: the widget is too small for a dial (in which case the numbers are the
 * normal rendering and need no explanation), or the attitude is not current (in
 * which case the missing dial is the whole point and must be accounted for).
 * Without that distinction a small widget would grow a permanent apology.
 *
 * **`useViewUt` is read HERE, not in the widget body, and that is not a style
 * choice.** It is per-frame reactive by design (a live countdown needs that), so
 * a widget body calling it re-renders at frame cadence for as long as it is
 * mounted, whether or not anything is stale. Navball has the heaviest SVG in the
 * set, and the same mistake repeated across the widgets about to grow age
 * captions would re-render the whole dashboard at 60 Hz, the identical churn the
 * reading's own identity memo was added to prevent, reintroduced one layer up.
 *
 * Reading it inside the component that renders the age means the subscription
 * exists only while a caption is on screen, and a healthy widget pays nothing.
 */
function AttitudeCurrency({
  reading,
  dialSuppressed,
}: {
  reading: Reading<unknown>;
  dialSuppressed: boolean;
}) {
  if (reading.state === "observed") return null;
  if (reading.state === "pending") {
    return <ReadoutCaption>Waiting for attitude telemetry</ReadoutCaption>;
  }
  // Not "waiting", which is what this said for the rest of the session on a
  // build with no attitude channel. Nothing is coming, and a dial that keeps
  // promising it will is the reason this arm exists.
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

/**
 * The dated half of the caption, split out purely so the per-frame `useViewUt`
 * subscription lives behind the `observed`/`pending`/`absent` early returns
 * above rather than in front of them: a hook cannot sit behind a conditional, so
 * the conditional has to become a component boundary.
 */
function StaleCaption({
  label,
  reading,
}: {
  label: string;
  reading: Reading<unknown>;
}) {
  const viewUt = useViewUt();
  // The age, spelled out now that `readingAge` is gone: an instant minus an instant
  // is a duration, and the affine rules make that the type. The clamp came with it
  // and stays, because samples arrive out of order (`ClientTimeline` insert-sorts
  // for it) so one can sit marginally ahead of the frame and "-0.4 s ago" is never
  // a thing to render.
  const observedUt = observedAt(reading);
  const ageSec =
    viewUt && observedUt
      ? Math.max(0, viewUt.minus(observedUt).magnitude)
      : undefined;
  return (
    <ReadoutCaption role="status">
      {label}
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

  /**
   * The unsuffixed `heading`/`pitch`/`roll` are the CoM-referenced frame and the
   * `*RootFrame` trio is the root-part-referenced one, confirmed against
   * `KspHost.BuildAttitude` and `VesselAttitude`'s class doc. That is the
   * opposite of what the field names suggest at a glance, so the ternary below
   * is deliberately "backwards" relative to them: `useCoMFrame` true means CoM,
   * its default false means root part, and both readings then agree with what
   * `NavballConfig` and the config-form copy promise.
   *
   * Attitude reads as a `Reading` because a dial is a claim about NOW, and an
   * attitude cannot be forward-modelled. Drawing `pitch ?? 0` / `roll ?? 0` /
   * `heading ?? 0` unconditionally, as this once did, paints a specific,
   * plausible, wrong orientation when nothing is on the wire: level, facing
   * north. An attitude is the reading an operator acts on most directly, so a
   * wrong one is a wrong input to a control decision rather than a cosmetic
   * defect.
   */
  const attitudeReading = useTelemetry("vessel.attitude");
  const attitude = lastObserved(attitudeReading);
  const attitudeObserved = attitudeReading.state === "observed";
  const heading = numericOrNull(
    attitude?.[useCoM ? "heading" : "headingRootFrame"],
  );
  const pitch = numericOrNull(attitude?.[useCoM ? "pitch" : "pitchRootFrame"]);
  const roll = numericOrNull(attitude?.[useCoM ? "roll" : "rollRootFrame"]);

  // `vessel.control` is declared unmodellable: a commanded state changes only
  // when a command lands, so there is no model, and the in-flight case is the
  // expectation channel's job rather than this read's. The buttons therefore
  // show the last CONFIRMED state on every arm that has one; `useCommandFailures`
  // and the control-delay strip are what say "something is in flight" beside
  // them, which is why a stale toggle here is not a lie.
  const control = lastObserved(useTelemetry("vessel.control"));
  const vesselState = useStream<VesselState>("vessel.state");
  const sasMode = vesselState?.sasModeName ?? undefined;
  const sasBadgeMode = sasMode ? badgeSasMode(sasMode) : "";
  // Magnitudes at the read: throttle drives a slider position and the delay
  // drives a threshold comparison, both of which are arithmetic. Left wrapped,
  // the `typeof === "number"` guards below answer "no reading" for every live
  // value, silently and completely.
  const throttle = magnitudeOr(control?.throttle, 0);
  const isControllable = vesselState?.isControllable !== false;

  /**
   * Throttle is the one continuous axis with a real bidirectional channel
   * (`vessel.control.throttle`), so it rides the delayed control-stream spine:
   * local state holds the operator's commanded intent, `useControlStream`
   * coalesces and dispatches it on the channel's write half, and rolls the
   * in-transit plus confirmed-readback buffer `<ControlDelayStream>` draws.
   *
   * The state tracks the live readback until the operator first touches a
   * throttle control (`throttleTouchedRef`), so simply opening the control
   * surface never silently commands the engine back to a stale default, the
   * write half dispatching unconditionally on its first tick notwithstanding.
   * The benign consequence is that on open, before the operator has touched
   * anything, that first tick re-commands the just-seeded value straight back
   * at the engine: the live readback it was already at, never a stale 0, so a
   * no-op in effect.
   *
   * The `vesselId`-keyed effect below resets `throttleTouchedRef` on a vessel
   * switch, so a freshly-switched craft re-seeds from its own live throttle
   * rather than carrying over the previous vessel's commanded value.
   */
  const [throttleCmd, setThrottleCmdState] = useState(throttle);
  const throttleTouchedRef = useRef(false);
  useEffect(() => {
    if (!throttleTouchedRef.current) setThrottleCmdState(throttle);
  }, [throttle]);
  const setThrottleCmd = (next: number | ((v: number) => number)) => {
    throttleTouchedRef.current = true;
    setThrottleCmdState(next);
  };
  /**
   * Vessel switch: re-arm the seed latch so the newly-active vessel's live
   * throttle wins over the previous vessel's stale commanded value. Keyed off
   * `vessel.identity.vesselId`, the same stable per-vessel id `TargetPicker`
   * and `LaunchDirector` dispatch against.
   *
   * An id, not a quantity, so it does not decay and a stale one is still which
   * vessel this is. Used only to scope per-vessel UI memory.
   */
  const activeVesselId = lastObserved(
    useTelemetry("vessel.identity"),
  )?.vesselId;
  const prevVesselIdRef = useRef(activeVesselId);
  useEffect(() => {
    if (activeVesselId !== prevVesselIdRef.current) {
      prevVesselIdRef.current = activeVesselId;
      throttleTouchedRef.current = false;
      // Re-seed immediately rather than waiting on the `throttle` effect's
      // own dependency to fire: the new vessel's live value may already be
      // sitting in `throttle` this render (the two topics often update in
      // the same telemetry frame), and this latch reset must not depend on
      // that coincidence.
      setThrottleCmdState(throttle);
    }
  }, [activeVesselId, throttle]);
  const throttleStream: ControlStream = useControlStream(
    "vessel.control.throttle",
    throttleCmd,
    {
      label: "Throttle",
      range: "unit",
      onDispatch: () => CONTROL_STREAM_BUDGET.record(),
    },
  );

  /**
   * Fly-by-wire attitude and translation axes are continuous per-frame control,
   * because KSP re-zeroes a raw axis every physics frame, so each rides
   * `useControlStream` exactly as the throttle does rather than a discrete
   * one-shot `useCommand`. The stream self-consumes its delay UX via
   * `<ControlDelayStream>`, so no `<CommandDelay>` is needed.
   *
   * Axes rest at 0 (neutral) and are commanded from the analog input handlers
   * below; values are -1..1, hence `range: "signed"`. The confirmed-readback
   * (echo) track is the vessel's applied ctrlState axis
   * (`vessel.control.{pitch,yaw,roll,translationX/Y/Z}`, published by
   * `KspHost.BuildControl`).
   */
  const [pitchCmd, setPitchCmd] = useState(0);
  const [yawCmd, setYawCmd] = useState(0);
  const [rollCmd, setRollCmd] = useState(0);
  const [translateXCmd, setTranslateXCmd] = useState(0);
  const [translateYCmd, setTranslateYCmd] = useState(0);
  const [translateZCmd, setTranslateZCmd] = useState(0);
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

  /**
   * SAS/RCS toggle, SAS mode and FBW arm/disarm are all discrete, absolute-set
   * vessel commands, the same toggle-invert shape `ActionGroup` uses, so they
   * ride `useCommand` and are subject to signal delay.
   */
  const sasCmd = useCommand("vessel.control.setSas");
  const rcsCmd = useCommand("vessel.control.setRcs");
  const sasModeCmd = useCommand("vessel.control.setSasMode");
  const fbwCmd = useCommand("vessel.control.setFlyByWire");
  usePanelDelay(sasCmd);
  usePanelDelay(rcsCmd);
  usePanelDelay(sasModeCmd);
  usePanelDelay(fbwCmd);

  /**
   * Pitch/yaw/roll TRIM. Trim is the one fly-by-wire input with no
   * `[SitrepControlChannel]`: `SetControlAxesArgs` carries the write fields
   * (`PitchTrim`/`YawTrim`/`RollTrim`) but `VesselControl` publishes no trim
   * READ field, so there is no echo to anchor a `useControlStream` on and the
   * axes above cannot absorb it. It therefore dispatches `setAxes` directly,
   * one nullable-partial field at a time so a trim never clobbers a live axis.
   */
  const trimCmd = useCommand("vessel.control.setAxes");
  usePanelDelay(trimCmd);
  const sendTrim = (
    field: "pitchTrim" | "yawTrim" | "rollTrim",
    raw: number,
  ) => {
    void trimCmd.send({ [field]: clamp(raw, -1, 1) });
  };

  // Uncoerced, and they reach the buttons that way: inverting an unresolved
  // value would be a blind guess (never dispatch an ambiguous toggle as a
  // blind set, same contract map-command.ts's `toggleHome` documents), and
  // `armLabel` needs the same three states to avoid rendering an unread arm as
  // a confirmed OFF.
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

  /**
   * The SAS-mode grid is this repo's reference control for the
   * `useCommandFailures` plus `data-failed` pattern. When a mode command goes
   * overdue or lost, the button that issued it echoes the failure on itself as
   * an amber `data-failed` tint, and clicking it dismisses through the same
   * shared dismiss the Panel-top queue uses, so clearing on either surface
   * clears both. The queue stays the primary failure surface and this is the
   * secondary in-context echo. Failed commands are matched back to their mode
   * by the label `setSasMode` stamps above.
   */
  const sasFailures = useCommandFailures(sasModeCmd);
  const failedSasModes = new Map<SasMode, string>();
  for (const f of sasFailures.failed) {
    const mode = SAS_MODES.find((m) => f.label === `SAS mode: ${m}`);
    if (mode) failedSasModes.set(mode, f.id);
  }

  /**
   * FBW arm/disarm, with auto-disarm on unmount. The state mirrors the latest
   * arm command rather than a telemetry read, because there is no readback for
   * FBW. `setFlyByWire` is absolute-set, the state travelling in the arg
   * itself, so unlike SAS/RCS it needs no invert.
   */
  const [fbwArmed, setFbwArmed] = useState(false);
  const fbwArmedRef = useRef(false);
  useEffect(() => {
    fbwArmedRef.current = fbwArmed;
  }, [fbwArmed]);
  useEffect(() => {
    return () => {
      // Release control on unmount regardless of state: the effect cleanup is the last reliable place to fire, so this cannot wait on a render-cycle setFbwArmed(false).
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

  /**
   * The FBW-under-delay warning, and whether the control-delay strip is drawn
   * at all. `comms.delay.oneWaySeconds` is gonogo's own SignalDelay authority,
   * a TrueNow channel that is never itself delayed, carrying a plain count of
   * one-way light-time seconds and 0 when the delay feature is off, so the
   * warning stays hidden with no separate "is it enabled" check.
   *
   * Read as last-observed on every arm that has one. Nothing models light-time
   * client-side, and a craft whose delay reading has gone quiet has not stopped
   * being far away, so suppressing the strip would hide the delay rather than
   * report it.
   */
  const delaySeconds = magnitudeOf(
    lastObserved(useTelemetry("comms.delay"))?.oneWaySeconds,
  );
  const delayHigh =
    delaySeconds !== null && delaySeconds > FBW_DELAY_WARN_SECONDS;
  const showFbwDelayWarning = fbwArmed && delayHigh;

  /**
   * Every action surface maps to a command dispatch, with analog values clamped
   * to [-1, 1] and throttle to [0, 1]. Button payloads only fire on the press
   * edge (`value=true`), so a hardware press-and-release does not trigger twice.
   */
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
      // Deliberately a no-op: precision control is readable but has no set command of its own (it moves only via the SAS path), and the action is declared anyway so a mapping survives the day a command arrives.
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
      if (p.kind !== "analog") return;
      setThrottleCmd(clamp(p.value as number, 0, 1));
    },
    "throttle-up": (p) =>
      isButtonPress(p) && setThrottleCmd((v) => clamp(v + 0.1, 0, 1)),
    "throttle-down": (p) =>
      isButtonPress(p) && setThrottleCmd((v) => clamp(v - 0.1, 0, 1)),
    "throttle-zero": (p) => isButtonPress(p) && setThrottleCmd(0),
    "throttle-full": (p) => isButtonPress(p) && setThrottleCmd(1),
    // Fly-by-wire axes drive their useControlStream state, which coalesces +
    // dispatches vessel.control.setAxes over the delayed write half. Each
    // per-axis translate binding sets its own component; the other axes hold
    // their last-commanded value.
    "set-pitch": (p) => {
      if (p.kind !== "analog") return;
      setPitchCmd(clamp(p.value as number, -1, 1));
    },
    "set-yaw": (p) => {
      if (p.kind !== "analog") return;
      setYawCmd(clamp(p.value as number, -1, 1));
    },
    "set-roll": (p) => {
      if (p.kind !== "analog") return;
      setRollCmd(clamp(p.value as number, -1, 1));
    },
    "translate-x": (p) => {
      if (p.kind !== "analog") return;
      setTranslateXCmd(clamp(p.value as number, -1, 1));
    },
    "translate-y": (p) => {
      if (p.kind !== "analog") return;
      setTranslateYCmd(clamp(p.value as number, -1, 1));
    },
    "translate-z": (p) => {
      if (p.kind !== "analog") return;
      setTranslateZCmd(clamp(p.value as number, -1, 1));
    },
    "set-pitch-trim": (p) => {
      if (p.kind !== "analog") return;
      sendTrim("pitchTrim", p.value as number);
    },
    "set-yaw-trim": (p) => {
      if (p.kind !== "analog") return;
      sendTrim("yawTrim", p.value as number);
    },
    "set-roll-trim": (p) => {
      if (p.kind !== "analog") return;
      sendTrim("rollTrim", p.value as number);
    },
  });

  /**
   * Measure the attitude column and pick a square dial size that fits both
   * axes. Reading only the width leaves the dial stuck small on a tall widget
   * and too big to leave room for the throttle column on a small one, so both
   * dimensions bind.
   *
   * The 600 ceiling is where the indicator's tick text starts to look blurry on
   * a standard-DPI screen. `MIN_DIAL_PX` is the other end: below it the dial is
   * illegible and the numeric readout is the better rendering.
   *
   * The value is the FIT, not a size clamped up to the floor, and that is the
   * whole point. Clamped up, a column too short for a legible dial got one
   * anyway: `AttitudeIndicator` is `MIN_DIAL_PX + ATTITUDE_CHROME_PX` tall at
   * the floor, and `DIAL_WRAP` centres it, so it painted equally far past both
   * ends of its box and the heading tape landed on the section below. Kept as
   * the fit, a column that cannot hold a dial reports so (see {@link
   * MIN_DIAL_PX}) and the widget renders the readout it degrades to at small
   * tile sizes anyway.
   *
   * 180 until the first observation, which is what a tree with no
   * `ResizeObserver` (jsdom) keeps: the dial is the right default for a widget
   * whose box nothing can measure.
   */
  const [dialFit, setDialFit] = useState(180);
  /**
   * Whether the numeric readout's three cells fit on one line, off the same
   * observation as {@link dialFit} and against {@link READOUT_TRIPLE_PX}.
   *
   * `true` until the first observation, for the same reason the fit starts at
   * 180: a row we know is always three is the right default for a widget whose
   * box nothing can measure.
   */
  const [readoutAcross, setReadoutAcross] = useState(true);
  const throttleReservedRef = useRef(false);
  const controlModeRef = useRef(false);
  const dialObserverRef = useRef<ResizeObserver | null>(null);
  /**
   * Attaches the observer as a CALLBACK ref rather than reading a `useRef` from
   * a mount effect, so it follows the element instead of a moment in time.
   *
   * The box it measures is the attitude column itself, which renders whichever
   * branch the widget is showing. Measuring the DIAL's box instead made the
   * measurement depend on its own verdict: the dial box only exists once an
   * attitude has been OBSERVED, and a reading starts out pending, so on the
   * first commit there was no box. A `[]`-dep effect read null there and never
   * ran again, which left the dial pinned to its initial size for the whole
   * session: 180px in every widget, including a 4-column tile 152px wide, where
   * it painted over the heading strip and the readout row below it and, in
   * control mode, over the SAS section as well. A callback ref fixed that half,
   * and the column fixes the rest: with the fit now deciding WHETHER to draw a
   * dial, a ref on the dial would stop observing the moment it said no, and the
   * dial could never come back when the tile grew.
   *
   * Measuring the column is also what keeps the decision from flip-flopping.
   * The attitude section is the body's only filling section, so with a dial
   * drawing it measures exactly the height the rest of the body leaves it. With
   * the readout drawing it measures that or the readout's own height, whichever
   * is larger (see {@link READOUT_FLOOR}), and the readout is far shorter than
   * the `MIN_DIAL_PX + ATTITUDE_CHROME_PX` a dial needs. So the fit crosses back
   * over that threshold only when the tile really has grown, never as a
   * consequence of having acted on it.
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
        /* Reserve space for the throttle column at every tile wide enough to
           carry one (~32 px bar + 10 px gap), whether or not one is on screen
           right now. The column rides `showDial`, so a reserve read off its
           visibility would be the second way the fit could depend on its own
           verdict: a width that fits a dial without the column and not with it
           would add the column, lose the dial, drop the reserve, and fit
           again. */
        const throttleReserve = throttleReservedRef.current ? 42 : 0;
        // The AttitudeIndicator renders its own heading strip and HDG/PIT/ROL
        // readout row *below* the SVG in the same column. Reserve that
        // vertical space so a wide-and-short box (e.g. mobile 9×8, where h is
        // the limiting dimension) doesn't size the dial to the full column
        // height and push the strip + readout past the Panel's bottom edge.
        const fit = Math.min(w - throttleReserve, h - ATTITUDE_CHROME_PX);
        // In control mode the dial competes with the SAS / throttle / FBW
        // surface for vertical space: cap it so the buttons stay readable.
        // The display-only path keeps the full 600px ceiling so a dedicated
        // big-navball widget still fills its slot.
        const cap = controlModeRef.current ? 200 : 600;
        setDialFit(Math.min(cap, Math.floor(fit)));
        /* The readout draws into this same column, so its own width is `w`
           undiminished: the throttle reserve above is the dial's business and
           the column carries no throttle bar when the readout is what
           renders. */
        setReadoutAcross(w >= READOUT_TRIPLE_PX);
      }
    });
    ro.observe(el);
    dialObserverRef.current = ro;
  }, []);

  // Selective rendering: at very small sizes the SVG dial doesn't have
  // room to be readable, so collapse to numeric heading/pitch/roll
  // readouts. The throttle column and mode badge row drop independently.
  //
  // The control-surface gate is intentionally strict (rows≥18, cols≥7)
  // because the SAS mode grid + throttle group + FBW row need ~350px of
  // vertical real estate on top of the dial + strip + readouts. Anything
  // smaller and the surface overlaps the dial. When the widget is too
  // small for the surface, control mode degrades to a regular dial, the
  // user keeps the deeper config selection without losing the readout.
  const cols = w ?? 8;
  const rows = h ?? 11;
  // The dial draws ONLY off an observed attitude.
  //
  // `Targeting` reached the same answer for its docking reticle and the
  // ball is the same kind of object, more so: both are instruments whose whole
  // meaning is "this is the situation NOW", and holding the last known value in
  // one is indistinguishable from a live reading. There is no caption that fixes
  // that, because the operator reads the picture, not the caption beside it. So
  // when the attitude is not current the dial goes away and the numeric readout
  // takes its place, dated. Refusing to draw is not refusing to tell.
  //
  // Deliberately NOT reckoned, and this is the honest reason rather than a gap:
  // an attitude is not forward-modellable from a snapshot. What changes it is
  // torque, from SAS or from a command we may ourselves have sent and which may
  // still be in flight, so the last known angles plus elapsed time say nothing
  // about the current ones. A craft tumbling and a craft holding are the same
  // reading here. That is why no reckoner is registered for `vessel.attitude`.

  // Grid units say whether a dial is WANTED here; the measured fit says
  // whether one will go. Both are needed and neither substitutes for the
  // other: rows and cols are known before layout and are what the tiny-tile
  // presentations key off, while the pixels a tile hands the attitude column
  // depend on everything else in the body. `rows >= 6` alone was the whole
  // gate until the SAS/RCS row moved into the body below, and a 5x8 tile that
  // cleared it by two rows had 91px of column for a 154px indicator.
  const dialWanted = rows >= 6 && cols >= 4 && dialFit >= MIN_DIAL_PX;
  const showDial = dialWanted && attitudeObserved;
  const showThrottleColumn = showDial && cols >= 5;
  // SAS / RCS / precision, in the BODY rather than the header aside.
  //
  // They were three hand-styled chips in `panelAside` until 2026-09-10, which
  // put two of the vessel's live control states next to the panel's status pill
  // and made the pill look like one more chip in a row of them. They are also
  // the widest thing the aside ever carried, and the aside collapses on a
  // MEASURED fit (usePanelAsideSize): title and aside stop fitting side by
  // side and the WHOLE aside goes behind a disclosure chevron, taking any
  // contributed alert with it. An Uplink badging a loss of control on the
  // `navball.badges` slot therefore had room for one short pill and no detail
  // beside it, measured, so the width the chips were using was not free.
  //
  // The same `cols >= 5` the badges used, so no tile that showed SAS and RCS
  // before loses them, and no tile that was too narrow for them gains a row it
  // has no width for.
  const showControlRow = cols >= 5;
  const showControlSurface = controlMode && rows >= 18 && cols >= 7;
  controlModeRef.current = showControlSurface;
  // Sync refs the ResizeObserver reads inside its closure, the observer
  // was created on mount with the initial values closed over, so updates
  // to either flag need to propagate via refs the callback re-reads on
  // each observation.
  throttleReservedRef.current = cols >= 5;

  return (
    <Panel
      panelTitle={showControlSurface ? "GNC CONTROL" : "ATTITUDE"}
      sections={[
        /* The attitude readout is the drawing: at any tile size worth showing a
           dial at, the dial should be as large as the tile allows rather than
           as large as its own minimum. */
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
                      <div
                        style={{
                          ...THROTTLE_FILL,
                          height: `${throttle * 100}%`,
                        }}
                      />
                    </div>
                    <span style={THROTTLE_VAL}>
                      <Unit value={value("%", throttle * 100)} decimals={0} />
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
        /* Full-width: a control strip the surface below it belongs to, never a
           column beside it. */
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
              throttleCmd={throttleStream.current}
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
      /* The aside carries alerts and nothing else now: this warning, whatever
         an Uplink contributes to `navball.badges`, and the panel's own status
         pill. Control STATE moved to the body (see `showControlRow`). */
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
 * The numeric readout's three cells, as data rather than three copies of the
 * same JSX.
 *
 * The row is ALWAYS these three, which is the whole reason it should never lay
 * out as two-then-one. Built as a list so the count is stated once and both
 * presentations ({@link READOUT_TRIPLE} and {@link READOUT_STACK}) render the
 * same three from it.
 *
 * Pitch and roll carry an explicit `+`: they are signed about a level attitude,
 * so an unsigned `45` reads as a magnitude rather than a nose-up 45 degrees.
 * Heading is a bearing and takes no sign.
 */
function attitudeCells(
  heading: number | null,
  pitch: number | null,
  roll: number | null,
): ReadonlyArray<{ label: string; value: ReactNode }> {
  // One element, never a fragment. Three across, the cell is a column flex box
  // and a sign beside its `Unit` would be a second FLEX ITEM: the `+` laid out
  // on a line of its own above the number it belongs to, which `white-space`
  // cannot reach because nothing had wrapped.
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
  /** SAS as read, UNCOERCED: absent is a third state here, not a false. See {@link armLabel}. */
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
 * SAS, RCS and precision control: two delay-aware toggles and one readout,
 * present at every tile wide enough to hold them rather than only in control
 * mode.
 *
 * Both toggles ride the same `useCommand` handles they always did
 * (`vessel.control.setSas` / `setRcs`, registered with the panel's delay rail
 * through `usePanelDelay`), so a command in flight still shows in the
 * Panel-top queue and a failed one still surfaces there. What changed is that
 * an operator on a display-sized tile can now press them: the header chips
 * they replace were `<span>`s, so SAS and RCS were readouts everywhere below
 * the control surface's rows>=18, cols>=7 threshold.
 *
 * The SAS toggle carries the active mode, because with the header chip gone
 * this is the only place the mode appears on a tile too small for the mode
 * grid. Same token the grid puts on its buttons, stutter included: see
 * {@link badgeSasMode}.
 *
 * Precision control is a readout among the toggles rather than a chip of its
 * own: it is a state of the same control surface, and the contract carries no
 * command to set it (`ActionDefinition` "toggle-precision" is declared and
 * deliberately inert).
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
        {/* Only once a reading has arrived: a dim chip is how OFF looks, so a
            dim chip for an unread precision state would be a confirmed-off
            that nothing confirmed. Absent, the row is two toggles wide. */}
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
 * One arm's toggle label: `SAS: PRO` / `RCS ON` when the arm is on, `SAS OFF`
 * when it is confirmed off, and the name plus the kit's no-reading mark when
 * nothing has been read.
 *
 * The third case is the one worth spelling out. `vessel.control` is declared
 * unmodellable, so before the first reading lands there is no state to report,
 * and "SAS OFF" would be a claim about the vessel that no telemetry supports.
 * The header chip this label replaces never made it: absent, it rendered the
 * bare word dark, and the widget's own characterisation test pins that
 * ("SAS mode unknown and SAS mode not reported look the same as each other").
 * The control surface's copy of these buttons DID make it, on the reasoning
 * that a tile showing the surface is a tile being flown; putting them on every
 * tile takes that reasoning away.
 *
 * `NULL_DISPLAY` rather than the bare name, because the bare name is not free:
 * the mode grid's `StabilityAssist` button is also labelled "SAS", so an unread
 * SAS arm and the button that engages stability assist had the same accessible
 * name, two rows apart, in control mode.
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
  /** Commanded throttle value (0..1): local operator intent, tracks the live readback until touched. Same value as `throttleStream.current`. */
  throttleCmd: number;
  onSetThrottleCmd: (next: number | ((v: number) => number)) => void;
  /** The delayed control-stream buffer for the throttle axis; feeds `<ControlDelayStream>`. */
  throttleStream: ControlStream;
  /** The delayed control-stream buffers for the fly-by-wire attitude +
   * translation axes (pitch/yaw/roll + RCS X/Y/Z); drawn on the same
   * `<ControlDelayStream>` graph as the throttle. */
  axisStreams: ControlStream[];
  fbwArmed: boolean;
  onArmFbw: () => void;
  onDisarmFbw: () => void;
  onSetSasMode: (mode: SasMode) => void;
  /** SAS modes whose issued command is currently failed (overdue or lost), mapped to that command's id so the button can dismiss it. */
  failedSasModes: Map<SasMode, string>;
  /** Clear a failed SAS-mode command, through the shared dismiss the Panel-top queue also uses. */
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
      {/* SAS, RCS, precision and the not-controllable banner all sit in
          `ControlToggles`, one section above: this surface is only ever
          rendered on a tile that also shows that row. */}
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
                  // Decorative: the short label beside it already names the
                  // mode, and the button carries its own accessible name.
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
            value={throttleCmd}
            onChange={(e) => onSetThrottleCmd(Number(e.target.value))}
            disabled={disabled}
            aria-label="Throttle"
            style={SLIDER}
          />
          <span style={SLIDER_VAL}>
            <Unit value={value("%", throttleCmd * 100)} decimals={0} />
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
            disabled={disabled}
          >
            −10%
          </Button>
          <Button
            type="button"
            onClick={() => onSetThrottleCmd((v) => clamp(v + 0.1, 0, 1))}
            disabled={disabled}
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
        {/*
          Continuous control-delay viz for ALL fly-by-wire axes: throttle plus
          pitch/yaw/roll + RCS X/Y/Z, each on its own vessel.control.* stream
          channel (LIVE-TEST-REQUIRED, see the axis-stream note in the parent
          body). Renders `null` when the one-way delay is near zero, so a
          direct link pays nothing; safe to always mount.
        */}
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
            {fbwArmed
              ? "Mapped pitch/yaw/roll/translate inputs are live."
              : "Bind axes via the Inputs tab, then arm to take stick control."}
          </span>
        </div>
        {showFbwDelayWarning && delaySeconds !== null && (
          <StatusIndicator tone="warn" live>
            High signal delay (<Countdown value={delaySeconds} precise />
            ), fly-by-wire stick input lags round-trip; expect to overcorrect.
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
 * The SAS toggle's mode token: the same three letters the SAS MODE grid puts on
 * its buttons.
 *
 * The full member name is what makes it a token rather than a name. It was in
 * the header aside until 2026-09-10 and pushed the badge row wide enough that
 * the Panel ellipsised its OWN title down to "GNC CO..."; on the toggle it has
 * a whole grid cell, but the cell still competes with two more toggles in the
 * same row, and the grid directly below spells the active mode out in full
 * behind its lit button anyway.
 *
 * `StabilityAssist` gets its token like every other mode, so the toggle reads
 * "SAS: SAS". It stutters, and it is still the right rendering: dropping the
 * suffix there instead makes it identical to the label shown when the mode is
 * not on the wire at all, and on a tile too small for the mode grid (which
 * needs rows>=18 and cols>=7) the toggle is the ONLY place the mode appears.
 * Consistency with the button an operator actually presses beats reading well.
 *
 * `Unknown` keeps its own name rather than becoming a symbol: it is the
 * contract's fallback for a mode this build cannot name, and a "?" would leave
 * an operator unable to tell it from a rendering fault.
 */
function badgeSasMode(mode: SasModeName): string {
  return mode === "Unknown" ? mode : modeShort(mode);
}

function isButtonPress(p: { kind: string; value: unknown }): boolean {
  return p.kind === "button" && p.value === true;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * An attitude angle as a number, wrapped or not.
 *
 * The readouts show degrees and the indicator rotates by them, so what this
 * wants is the magnitude. A `typeof === "number"` test answered "no reading"
 * for every one, which rendered three em dashes over a flying vessel.
 */
function numericOrNull(v: unknown): number | null {
  return magnitudeOf(v as Quantityish);
}

// ── Config component ──────────────────────────────────────────────────────────

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

// ── Styles ────────────────────────────────────────────────────────────────────

// Structural inline styles (CSS-var tokens): a bespoke dial + control surface,
// no reusable ui-kit primitive fits, so the layout stays local. The off-scale
// readout font (18px), the off-ladder dial gap (10px, a ResizeObserver-reserve
// term) and the 80ms throttle chase are deliberately literal (see each note)
// and were already literal in the styled blocks this replaces.

/**
 * Stops the attitude section shrinking under the numeric readout, which has a
 * height and cannot resize itself the way the dial can.
 *
 * A filling section takes the height the rest of the body leaves it, `min-height:0`
 * and all, so a body that outgrows its tile crushes this one and nothing else.
 * That is right while the dial is drawing, which is why the shrink is there:
 * the dial is measured and redrawn at whatever it is given. It is wrong for the
 * readout, which keeps painting at its own height wherever the box ends, and at
 * a 33px section on an uncontrollable 5x8 tile that put three angles across the
 * "vessel not controllable" banner below.
 *
 * Refusing to shrink hands the overflow to the panel body, which is the
 * scroller, so the crushed tile scrolls instead of stacking two readings in one
 * place. `flex-shrink` only, so the section still GROWS into whatever the tile
 * has spare, which is what lets a growing tile measure its way back to a dial.
 */
const READOUT_FLOOR: CSSProperties = { flexShrink: 0 };

/**
 * The measured box, and the one thing in the attitude section that renders
 * whichever way the fit goes. It carries the fill so the dial wrap and the
 * numeric readout below it can go on carrying theirs, and it holds no visual
 * treatment of its own: what it is for is being the same box in both branches.
 */
const ATTITUDE_COLUMN: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const DIAL_WRAP: CSSProperties = {
  // Fill the available column so the ResizeObserver sees real dimensions,
  // without flex:1 the wrap collapses to its content and the dial gets stuck at
  // whatever size it last resolved to.
  flex: 1,
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  // Off the spacing ladder: this 10 is a term in the ResizeObserver's
  // throttleReserve = 42 ("~32 px bar + 10 px gap") in this file. It is
  // computed, not chosen, so it moves only when that constant moves.
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
 * HDG, PCH and RLL on one line, three equal columns.
 *
 * Never `auto-fit`, and never a wrap. Both let the row decide its own arity
 * from whatever happens to fit, and the row is ALWAYS three: what they
 * produced was two cells with the third slung underneath, and, because a
 * cell's width follows its digit count, which shape you got depended on the
 * vessel's attitude. A level craft laid out two-then-one and a climbing one
 * stacked all three, in the same tile, on the same tier.
 *
 * The cells here are label-over-value rather than label-beside-value, which is
 * what makes three across affordable: measured at the widest readings, three
 * pairs side by side need 290px and three stacked cells need 168, so the tier
 * where the complaint was seen (7 columns, a 238px column) goes from
 * two-then-one to three across. It is also the shape `AttitudeIndicator` gives
 * the same three readings under its own dial.
 *
 * Under {@link READOUT_TRIPLE_PX} three genuinely will not fit, and what that
 * width gets is {@link READOUT_STACK}: all three on their own lines, which is
 * what the 3x4 minimum has always shown. One shape or the other, never a
 * mixture.
 */
const READOUT_TRIPLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "var(--gap-related)",
};

/**
 * The too-narrow answer: one reading per line, in the compact
 * label-beside-value shape.
 *
 * The pairs stay horizontal here on purpose. Stacked cells in a single column
 * are 136px tall against the pairs' 85, and this is the presentation a column
 * of 78px gets: at the 3x4 minimum that height does not exist, and the readout
 * painted over the section below it the last time something in this widget
 * assumed it did.
 */
const READOUT_STACK: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
};

/**
 * The two overrides a `BigReadout` needs to be one of three in a row rather
 * than one hero filling a panel.
 *
 * `font-size` because its own is `clamp(20px, 6vw, 38px)`, and a dashboard
 * tile's width has no fixed relationship to the viewport: three readings on a
 * 5-column tile would be typeset off the browser window. Fixed rather than a
 * narrower clamp, and off the type scale for the reason the readout it replaces
 * was, the scale stopping at 16px. `CrewStatus` overrides the same clamp for
 * the same kind of reason.
 *
 * `min-width` because `BigReadout` sets it to 0 and the `1fr` columns are
 * `minmax(auto, 1fr)`: with the cells' own minimum zeroed, all three collapse
 * and the readings overflow silently at every width. That minimum is what
 * {@link READOUT_TRIPLE_PX} is measured against.
 *
 * `tabular-nums` and `nowrap` are not overrides, they are the two things the
 * kit does not carry and a live reading needs. Tabular figures stop a changing
 * heading from jittering the row. `nowrap` stops the reading reflowing inside
 * its own cell: pitch and roll are a sign followed by a `Unit`, which are
 * separate inline boxes, so the cell's min-content is the number with the sign
 * broken onto a line of its own, and that is the width the grid would otherwise
 * be free to squeeze it to.
 */
const READOUT_CELL: CSSProperties = {
  fontSize: "18px",
  minWidth: "auto",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const READOUT_PAIR: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--gap-related)",
};

/**
 * The label in {@link READOUT_STACK}, beside its value rather than under it.
 * The 28px floor is what lines the three values up when they sit above each
 * other; three-across the label is a `ReadoutCaption` under its own reading and
 * needs no floor.
 */
const READOUT_LABEL: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.12em",
  color: "var(--color-text-faint)",
  minWidth: "28px",
};

const READOUT_VALUE: CSSProperties = {
  /* The top of the type scale. A display tier above it would want a token
     rather than a bare px here, and the scale does not carry one; 16px is the
     largest size this readout can take while staying inside the system. */
  fontSize: "var(--font-size-lg)",
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
  fontSize: "var(--font-size-2xs)",
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
  // Off the motion scale on purpose: an 80ms chase on live throttle, not a
  // UI-motion choice. --duration-instant is the hover rung, and retuning it
  // must not change how the bar tracks telemetry.
  transition: "height 80ms linear",
};

const THROTTLE_VAL: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
};

const CONTROL_WRAP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  paddingTop: "var(--space-6)",
  borderTop: "1px solid var(--color-surface-raised)",
};

const BANNER: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-status-warning-bg)",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-status-warning-bg)",
  borderRadius: "var(--radius-xs)",
};

const GROUP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
};

const GROUP_LABEL: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
};

/**
 * 68px holds a mode button's whole content: 12px of ToggleButton padding each
 * side, the 14px marker, the 4px gap, and three JetBrains Mono characters at
 * --font-size-sm (12px × 0.6em advance = 21.6px), which is 63.6px with a little
 * slack for a fallback face.
 *
 * The marker is what a narrower column costs. An `<svg>` carries the UA's
 * `overflow: hidden`, so its automatic minimum size is zero and it is the first
 * thing a too-narrow flex row gives up, while the label keeps every pixel: at
 * 48px the glyph laid out 2px wide in a 7-column widget and 0px wide in a
 * 9-column one, present in the DOM and painting nothing.
 */
const BUTTON_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(68px, 1fr))",
  gap: "var(--gap-related)",
};

/**
 * The SAS/RCS/precision row, packed by the width each control actually needs.
 *
 * A uniform column minimum could not do this, and that is what it was: measured
 * on the live buttons at `size="sm"`, the three need 71px ("SAS: PRO"), 65px
 * ("RCS OFF") and 78px ("PRECISION"), so `repeat(auto-fit, minmax(76px, 1fr))`
 * charged all three the widest one's width and refused a three-across line
 * until 244px and a two-across line until 160. The body at 5 columns is 158,
 * two pixels short, so the row stacked one toggle per line and took 100px of a
 * 191px body: the same height the dial needs, spent on three buttons that
 * measure 214px laid end to end.
 *
 * Sized by their own content instead, they share a line from 230px and SAS and
 * RCS share one from 144. Three across is not reachable at 5 columns whatever
 * the template, because 214 does not fit in 158; what that tier gets is SAS and
 * RCS side by side with precision under them, 64px rather than 100.
 */
const TOGGLE_ROW: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--gap-related)",
};

/**
 * Grow to share the line, never shrink below the label.
 *
 * The no-shrink half is load-bearing. A `ToggleButton` is an `inline-flex`, so
 * its automatic minimum size is its widest WORD, not its label: allowed to
 * shrink, "SAS: PRO" breaks across two lines inside its own border box and
 * "PRECISION" overflows the box outright, both before the row agrees to wrap.
 * That was already happening at the mode grid's 68px, ragged at 7 columns and
 * spilling 4px at 8.
 */
const TOGGLE_CELL: CSSProperties = { flex: "1 0 auto" };

const SLIDER_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
};

const SLIDER: CSSProperties = { flex: 1 };

const SLIDER_VAL: CSSProperties = {
  fontSize: "var(--font-size-xs)",
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
  fontSize: "var(--font-size-2xs)",
  color: "var(--color-text-faint)",
};

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<NavballConfig>({
  id: "navball",
  name: "Navball / Attitude Director",
  description:
    "Attitude indicator + control surface. Reads heading/pitch/roll and exposes a deep action surface (every SAS mode, throttle, fly-by-wire pitch/yaw/roll, RCS translation and trim) so a hardware stick mapped via the Inputs tab can fly the vessel.",
  tags: ["telemetry", "control"],
  defaultSize: { w: 8, h: 11 },
  minSize: { w: 3, h: 4 },
  component: NavballComponent,
  configComponent: NavballConfigComponent,
  // Both attitude frames are declared because the widget reads whichever the
  // `useCoMFrame` config selects: `heading`/`pitch`/`roll` are CoM-referenced,
  // the `*RootFrame` trio is the genuinely distinct root-part frame
  // `VesselAttitude` carries alongside it.
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: { useCoMFrame: false, controlMode: false },
  actions: navballActions,
  pushable: true,
  requires: ["flight"],
});

export { NavballComponent };
