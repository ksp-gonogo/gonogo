import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  PerfBudget,
  registerComponent,
  useActionInput,
  useExecuteAction,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { ControlStream } from "@ksp-gonogo/sitrep-client";
import {
  useCommand,
  useControlStream,
  useStream,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Button,
  CommandDelay,
  type CommandDelayHandle,
  ConfigForm,
  ControlDelayStream,
  Countdown,
  Field,
  FieldHint,
  FieldLabel,
  NULL_DISPLAY,
  Panel,
  Select,
  StatusIndicator,
  Switch,
  ToggleButton,
  Unit,
  useModalSaveBar,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "../shared/magnitude";
import { AttitudeIndicator } from "./AttitudeIndicator";

/**
 * Warn once one-way signal delay crosses this threshold AND fly-by-wire is
 * armed. The felt control-loop lag is ~2x one-way (command out + result
 * back), so 1s one-way ≈ 2s round-trip, the point past which closed-loop
 * stick flying stops working. Below that FBW is sloppy but usable; holding
 * the warning here avoids nuisance flashes on sub-second LAN jitter. `1.0`
 * mirrors the shared `formatDuration` helper's ms-below-1s breakpoint, an
 * already-meaningful threshold in this codebase, tunable here if a live
 * session says otherwise.
 */
const FBW_DELAY_WARN_SECONDS = 1.0;

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

const SAS_MODES = [
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
] as const;
type SasMode = (typeof SAS_MODES)[number];

interface NavballConfig {
  /** When true, read the CoM-referenced attitude frame (n.heading/pitch/roll). Default false reads the root-part-referenced frame (n.heading2/pitch2/roll2); see the component body's ternary comment for which raw key backs which frame. */
  useCoMFrame?: boolean;
  /** When true, render the control surface; otherwise show display-only. */
  controlMode?: boolean;
}

// `navball.badges` is a header badge slot (augment-slot-map.md): a broad
// escape-hatch for small inline indicators alongside the SAS-mode / RCS
// badges. The proposed filler is a future autopilot Uplink (MechJeb-alike)
// surfacing its active mode next to SAS/RCS, a badge that reads its OWN
// Domain's Topics, not the navball's attitude reads, so the slot passes no
// props. Declaration-merge the slot id → props type into core's `SlotRegistry`
// so `registerAugment` and `<AugmentSlot name="navball.badges" ...>`
// type-check against an empty-props contract rather than the loose
// `Record<string, unknown>` fallback. Kept co-located here (not in a shared
// central file) so parallel per-widget slot work never collides.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "navball.badges": Record<string, never>;
  }
}

// Action surface: kept verbose so each axis / mode is independently
// mappable to a hardware input. The order matches the visible button rows
// for cognitive consistency.
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

function NavballComponent({
  config,
  onConfigChange,
  w,
  h,
}: Readonly<ComponentProps<NavballConfig>>) {
  const useCoM = config?.useCoMFrame === true;
  const controlMode = config?.controlMode === true;

  // VERIFIED (KspHost.BuildAttitude / VesselAttitude.cs class doc): the
  // UNSUFFIXED n.heading/pitch/roll are the CoM-referenced frame; the *2
  // suffix is the genuinely distinct ROOT-PART-referenced frame, the
  // OPPOSITE pairing a naive reading of Telemachus's old root-vs-CoM
  // convention would suggest. The ternary below is deliberately "backwards"
  // relative to the key names so the toggle's OWN semantics (useCoMFrame
  // true = CoM, default false = root part, both documented on
  // NavballConfig/the config-form copy below) read correctly against the
  // real frames.
  const attitude = useTelemetry("vessel.attitude");
  const heading = numericOrNull(
    attitude?.[useCoM ? "heading" : "headingRootFrame"],
  );
  const pitch = numericOrNull(attitude?.[useCoM ? "pitch" : "pitchRootFrame"]);
  const roll = numericOrNull(attitude?.[useCoM ? "roll" : "rollRootFrame"]);

  const control = useTelemetry("vessel.control");
  const vesselState = useStream<VesselState>("vessel.state");
  const sasMode = vesselState?.sasModeName ?? undefined;
  const sasOn = control?.sas === true;
  const rcsOn = control?.rcs === true;
  const precisionOn = control?.precisionControl === true;
  // Magnitudes at the read: throttle drives a slider position and the delay
  // drives a threshold comparison, both of which are arithmetic. Left wrapped,
  // the `typeof === "number"` guards below answer "no reading" for every live
  // value, silently and completely.
  const throttle = magnitudeOr(control?.throttle, 0);
  const isControllable = vesselState?.isControllable !== false;

  // Connectivity indicator (mirroring the WarpControl pilot):
  // `n.heading` is representative of the widget's mapped attitude/control
  // read set regardless of the CoM-frame toggle (both n.heading and
  // n.heading2 are mapped on the wire now, off the same
  // vessel.attitude topic): so it stays a stable status source across
  // config changes rather than switching with `useCoM`.

  // Continuous/analog controls: pitch/yaw/roll axes, RCS translation, and
  // trim stay on the legacy string-action path (K5 in the command-surface
  // delay audit). FOLLOW-ON, not fabricated here: `VesselControl` (mod/
  // Sitrep.Contract) has no pitch/yaw/roll READ fields and no
  // `[SitrepControlChannel]` declarations for those axes yet, so
  // `getControlChannel("vessel.control.pitch"/".yaw"/".roll")` would resolve
  // `undefined` today. Wiring them needs the read fields + channel
  // attributes added to the contract first, then the same
  // `useControlStream` treatment throttle gets below. Closing a full
  // attitude-control loop across signal delay is also a control-theory
  // problem needing a select-then-commit `CommandGroup` design, out of
  // scope here regardless.
  const execute = useExecuteAction("data");

  // Throttle is the one continuous axis with a real bidirectional channel
  // today (`vessel.control.throttle`), so it rides the delayed
  // control-stream spine instead of the legacy path: local state holds the
  // operator's commanded intent, `useControlStream` coalesces + dispatches
  // it on the channel's write half and rolls the in-transit +
  // confirmed-readback buffer `<ControlDelayStream>` draws. The state
  // tracks the live readback until the operator first touches a throttle
  // control (`throttleTouchedRef`), so simply opening the control surface
  // never silently commands the engine back to a stale default (the write
  // half dispatches unconditionally on its first tick, same as the SAS/RCS
  // bridges above). Conscious, benign consequence: on open, before the
  // operator has touched anything, that first tick re-commands the
  // just-seeded value straight back at the engine, i.e. the live readback
  // it was already at, never a stale 0 or default; a no-op in effect.
  //
  // Reset `throttleTouchedRef` on a vessel switch so a freshly-switched
  // craft re-seeds from ITS live throttle instead of carrying over the
  // previous vessel's commanded value: see the `vesselId`-keyed effect
  // below.
  const [throttleCmd, setThrottleCmdState] = useState(throttle);
  const throttleTouchedRef = useRef(false);
  useEffect(() => {
    if (!throttleTouchedRef.current) setThrottleCmdState(throttle);
  }, [throttle]);
  const setThrottleCmd = (next: number | ((v: number) => number)) => {
    throttleTouchedRef.current = true;
    setThrottleCmdState(next);
  };
  // Vessel switch: re-arm the seed latch so the newly-active vessel's live
  // throttle wins over the previous vessel's stale commanded value. Keyed
  // off `vessel.identity.vesselId`, the same stable per-vessel id
  // `TargetPicker`/`LaunchDirector` dispatch against.
  const activeVesselId = useTelemetry("vessel.identity")?.vesselId;
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

  // Delayed vessel commands (command-surface-delay-audit #9,#11): SAS/RCS
  // toggle, SAS mode, and FBW arm/disarm are all discrete, absolute-set
  // vessel commands (the same toggle-invert shape ActionGroup migrated),
  // so they ride `useCommand` instead of the legacy string-action path.
  const sasCmd = useCommand("vessel.control.setSas");
  const rcsCmd = useCommand("vessel.control.setRcs");
  const sasModeCmd = useCommand("vessel.control.setSasMode");
  const fbwCmd = useCommand("vessel.control.setFlyByWire");

  // Raw (uncoerced) current values for the toggle-invert guard: `sasOn`/
  // `rcsOn` above already collapse "unknown" to `false` for DISPLAY, but
  // inverting an unresolved value would be a blind guess (never dispatch an
  // ambiguous toggle as a blind set, same contract map-command.ts's
  // `toggleHome` documents).
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
    // SAS_MODES is hand-ordered to match the SasMode C# enum ordinal
    // exactly (see map-command.ts's SAS_MODE_ORDINALS doc comment), so the
    // array index IS the ordinal, no separate lookup table needed here.
    void sasModeCmd.send(
      { mode: SAS_MODES.indexOf(mode) },
      { label: `SAS mode: ${mode}` },
    );
  };

  // FBW arm/disarm with auto-disarm on unmount. State mirrors the latest
  // arm command rather than a Telemachus key, no readback for FBW.
  // `setFlyByWire` is absolute-set (state travels in the arg itself), no
  // invert needed, unlike SAS/RCS.
  const [fbwArmed, setFbwArmed] = useState(false);
  const fbwArmedRef = useRef(false);
  useEffect(() => {
    fbwArmedRef.current = fbwArmed;
  }, [fbwArmed]);
  useEffect(() => {
    return () => {
      // Component unmounting: release control regardless of state. Don't
      // wait for the render-cycle setFbwArmed(false), the effect cleanup
      // is the last reliable place to fire.
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

  // FBW-under-delay warning. `comms.delay.oneWaySeconds` is gonogo's own
  // SignalDelay authority (a TrueNow channel, never itself delayed), a plain
  // number of one-way light-time seconds, 0 when the delay feature is
  // disabled, so the warning naturally stays hidden with no extra "is it
  // enabled" check.
  const delaySeconds = magnitudeOf(useTelemetry("comms.delay")?.oneWaySeconds);
  const delayHigh =
    delaySeconds !== null && delaySeconds > FBW_DELAY_WARN_SECONDS;
  const showFbwDelayWarning = fbwArmed && delayHigh;

  // Action wiring: every action surface has a mapping into a Telemachus
  // execute call, with analog values clamped to [-1, 1] and throttle to
  // [0, 1]. Button payloads only fire on the press edge (value=true) so
  // a hardware press+release doesn't trigger twice.
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
      // No dedicated key in Telemachus: toggling FBW pitch trim doesn't
      // help. v.precisionControlValue is a read; setting precision happens
      // via the SAS path. For now treat as a no-op with a console hint.
      // (Surfaced as an action so a future Telemachus version can wire it.)
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
    "set-pitch": (p) => {
      if (p.kind !== "analog") return;
      void execute(`v.setPitch[${clamp(p.value as number, -1, 1).toFixed(3)}]`);
    },
    "set-yaw": (p) => {
      if (p.kind !== "analog") return;
      void execute(`v.setYaw[${clamp(p.value as number, -1, 1).toFixed(3)}]`);
    },
    "set-roll": (p) => {
      if (p.kind !== "analog") return;
      void execute(`v.setRoll[${clamp(p.value as number, -1, 1).toFixed(3)}]`);
    },
    "translate-x": (p) => {
      if (p.kind !== "analog") return;
      // Telemachus exposes v.setTranslation[x,y,z] only: synthesize the
      // missing axes from zero so per-axis bindings can each fire alone.
      const v = clamp(p.value as number, -1, 1);
      void execute(`v.setTranslation[${v.toFixed(3)},0,0]`);
    },
    "translate-y": (p) => {
      if (p.kind !== "analog") return;
      const v = clamp(p.value as number, -1, 1);
      void execute(`v.setTranslation[0,${v.toFixed(3)},0]`);
    },
    "translate-z": (p) => {
      if (p.kind !== "analog") return;
      const v = clamp(p.value as number, -1, 1);
      void execute(`v.setTranslation[0,0,${v.toFixed(3)}]`);
    },
    "set-pitch-trim": (p) => {
      if (p.kind !== "analog") return;
      void execute(
        `f.setPitchTrim[${clamp(p.value as number, -1, 1).toFixed(3)}]`,
      );
    },
    "set-yaw-trim": (p) => {
      if (p.kind !== "analog") return;
      void execute(
        `f.setYawTrim[${clamp(p.value as number, -1, 1).toFixed(3)}]`,
      );
    },
    "set-roll-trim": (p) => {
      if (p.kind !== "analog") return;
      void execute(
        `f.setRollTrim[${clamp(p.value as number, -1, 1).toFixed(3)}]`,
      );
    },
  });

  // Measure the dial's available box and pick a square size that fits both
  // axes. The previous version capped at 220 px and read width only, that
  // left the dial stuck small on tall/wide widgets, and on small widgets it
  // never shrank enough to leave room for the throttle column. Cap at 600
  // because the indicator's tick text becomes blurry beyond that on
  // standard-DPI screens; below 80 the dial is illegible and we'd be better
  // dropping to numeric readout, which the rows-based gate above handles.
  const [dialSize, setDialSize] = useState(180);
  const dialRef = useRef<HTMLDivElement>(null);
  const showThrottleColumnRef = useRef(false);
  const controlModeRef = useRef(false);
  useEffect(() => {
    const el = dialRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        const h = e.contentRect.height;
        if (w <= 0 || h <= 0) continue;
        // Reserve space for the throttle column when it's visible: ~32 px
        // bar + 10 px gap.
        const throttleReserve = showThrottleColumnRef.current ? 42 : 0;
        // The AttitudeIndicator renders its own heading strip (~22 px) and
        // HDG/PIT/ROL readout row (~40 px) *below* the SVG in the same
        // column. Reserve that vertical space so a wide-and-short box (e.g.
        // mobile 9×8, where h is the limiting dimension) doesn't size the
        // dial to the full column height and push the strip + readout past
        // the Panel's bottom edge. In w-limited modes (medium/wide) and the
        // cap=200 control modes this reserve doesn't bind, so they're
        // unchanged.
        const verticalReserve = 74;
        const fit = Math.min(w - throttleReserve, h - verticalReserve);
        // In control mode the dial competes with the SAS / throttle / FBW
        // surface for vertical space: cap it so the buttons stay readable.
        // The display-only path keeps the full 600px ceiling so a dedicated
        // big-navball widget still fills its slot.
        const cap = controlModeRef.current ? 200 : 600;
        const next = Math.max(80, Math.min(cap, Math.floor(fit)));
        setDialSize(next);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
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
  const showDial = rows >= 6 && cols >= 4;
  const showThrottleColumn = showDial && cols >= 5;
  const showModeBadges = cols >= 5;
  const showControlSurface = controlMode && rows >= 18 && cols >= 7;
  controlModeRef.current = showControlSurface;
  // Sync refs the ResizeObserver reads inside its closure, the observer
  // was created on mount with the initial values closed over, so updates
  // to either flag need to propagate via refs the callback re-reads on
  // each observation.
  showThrottleColumnRef.current = showThrottleColumn;

  return (
    <Panel
      panelTitle={showControlSurface ? "GNC CONTROL" : "ATTITUDE"}
      panelAside={
        showModeBadges ? (
          <div style={MODE_BADGE_ROW}>
            <span style={modeBadgeStyle(sasOn)}>
              SAS{sasMode ? `: ${sasMode}` : ""}
            </span>
            <span style={modeBadgeStyle(rcsOn)}>RCS</span>
            {precisionOn && <span style={modeBadgeStyle(true)}>PRECISION</span>}
            {showFbwDelayWarning && delaySeconds !== null && (
              <Badge severity="warning" size="sm">
                FBW · <Countdown value={delaySeconds} precise /> DELAY
              </Badge>
            )}
            {/* Header badge slot (augment-slot-map.md): an autopilot Uplink can
                surface its active mode here, alongside SAS/RCS. Renders nothing
                until an augment binds `navball.badges`. */}
            <AugmentSlot name="navball.badges" props={{}} />
          </div>
        ) : undefined
      }
    >
      <div style={BODY}>
        {showDial ? (
          <div ref={dialRef} style={DIAL_WRAP}>
            <AttitudeIndicator
              heading={heading}
              pitch={pitch}
              roll={roll}
              size={dialSize}
            />
            {showThrottleColumn && (
              <div style={THROTTLE_COLUMN}>
                <span style={THROTTLE_LABEL}>THR</span>
                <div style={THROTTLE_BAR}>
                  <div
                    style={{ ...THROTTLE_FILL, height: `${throttle * 100}%` }}
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
            <div style={READOUT_ROW}>
              <span style={READOUT_LABEL}>HDG</span>
              <span style={READOUT_VALUE}>
                {heading === null ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("°", heading)} decimals={0} />
                )}
              </span>
            </div>
            <div style={READOUT_ROW}>
              <span style={READOUT_LABEL}>PCH</span>
              <span style={READOUT_VALUE}>
                {pitch === null ? (
                  NULL_DISPLAY
                ) : (
                  <>
                    {pitch >= 0 ? "+" : ""}
                    <Unit value={value("°", pitch)} decimals={0} />
                  </>
                )}
              </span>
            </div>
            <div style={READOUT_ROW}>
              <span style={READOUT_LABEL}>RLL</span>
              <span style={READOUT_VALUE}>
                {roll === null ? (
                  NULL_DISPLAY
                ) : (
                  <>
                    {roll >= 0 ? "+" : ""}
                    <Unit value={value("°", roll)} decimals={0} />
                  </>
                )}
              </span>
            </div>
          </div>
        )}

        {showControlSurface && (
          <ControlSurface
            disabled={!isControllable}
            sasMode={sasMode ?? null}
            sasOn={sasOn}
            rcsOn={rcsOn}
            precisionOn={precisionOn}
            throttleCmd={throttleStream.current}
            onSetThrottleCmd={setThrottleCmd}
            throttleStream={throttleStream}
            fbwArmed={fbwArmed}
            onArmFbw={armFbw}
            onDisarmFbw={disarmFbw}
            onToggleSas={toggleSas}
            onToggleRcs={toggleRcs}
            onSetSasMode={setSasMode}
            showFbwDelayWarning={showFbwDelayWarning}
            delaySeconds={delaySeconds}
            commandHandles={[sasCmd, rcsCmd, sasModeCmd, fbwCmd]}
          />
        )}
      </div>
    </Panel>
  );
}

interface ControlSurfaceProps {
  disabled: boolean;
  sasMode: string | null;
  sasOn: boolean;
  rcsOn: boolean;
  precisionOn: boolean;
  /** Commanded throttle value (0..1): local operator intent, tracks the live readback until touched. Same value as `throttleStream.current`. */
  throttleCmd: number;
  onSetThrottleCmd: (next: number | ((v: number) => number)) => void;
  /** The delayed control-stream buffer for the throttle axis; feeds `<ControlDelayStream>`. Pitch/yaw/roll aren't included: see the follow-on note in the parent component body. */
  throttleStream: ControlStream;
  fbwArmed: boolean;
  onArmFbw: () => void;
  onDisarmFbw: () => void;
  onToggleSas: () => void;
  onToggleRcs: () => void;
  onSetSasMode: (mode: SasMode) => void;
  showFbwDelayWarning: boolean;
  delaySeconds: number | null;
  /** The SAS/RCS/SAS-mode/FBW command handles, rendered as one merged
   * `<CommandDelay>` in-flight list. */
  commandHandles: CommandDelayHandle[];
}

function ControlSurface({
  disabled,
  sasMode,
  sasOn,
  rcsOn,
  precisionOn,
  throttleCmd,
  onSetThrottleCmd,
  throttleStream,
  fbwArmed,
  onArmFbw,
  onDisarmFbw,
  onToggleSas,
  onToggleRcs,
  onSetSasMode,
  showFbwDelayWarning,
  delaySeconds,
  commandHandles,
}: ControlSurfaceProps) {
  return (
    <div style={CONTROL_WRAP}>
      {disabled && (
        <div style={BANNER} role="status" aria-live="polite">
          Vessel not controllable: buttons disabled.
        </div>
      )}
      <CommandDelay
        handles={commandHandles}
        ariaLabel="Navball commands: in flight"
      />
      <div style={GROUP}>
        <div style={GROUP_LABEL}>SAS</div>
        <div style={BUTTON_GRID}>
          <ToggleButton
            type="button"
            active={sasOn}
            onClick={onToggleSas}
            disabled={disabled}
          >
            {sasOn ? "SAS ON" : "SAS OFF"}
          </ToggleButton>
          <ToggleButton
            type="button"
            active={rcsOn}
            onClick={onToggleRcs}
            disabled={disabled}
          >
            {rcsOn ? "RCS ON" : "RCS OFF"}
          </ToggleButton>
          <ToggleButton type="button" active={precisionOn} disabled>
            PRECISION
          </ToggleButton>
        </div>
      </div>

      <div style={GROUP}>
        <div style={GROUP_LABEL}>SAS Mode</div>
        <div style={BUTTON_GRID}>
          {SAS_MODES.map((mode) => (
            <ToggleButton
              key={mode}
              type="button"
              active={sasMode === mode}
              onClick={() => onSetSasMode(mode)}
              disabled={disabled}
            >
              {modeShort(mode)}
            </ToggleButton>
          ))}
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
          Continuous control-delay viz for the throttle axis, the reference
          surface for this design: pitch/yaw/roll aren't included, see the
          follow-on note above `throttleStream`'s declaration (no read
          fields / [SitrepControlChannel] declarations for those axes yet).
          Renders `null` when the one-way delay is near zero, so a direct
          link pays nothing; safe to always mount.
        */}
        <ControlDelayStream
          streams={[throttleStream]}
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

// Wrap badges onto a second line at narrow widths instead of pushing the
// trailing badge (RCS / PRECISION) past the clipped panel edge. Align right so
// they stay grouped under the SAS badge.
const MODE_BADGE_ROW: CSSProperties = {
  display: "flex",
  gap: "var(--space-4)",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  minWidth: 0,
};

function modeBadgeStyle(on: boolean): CSSProperties {
  return {
    fontSize: "var(--font-size-2xs)",
    fontWeight: 700,
    letterSpacing: "0.08em",
    padding: "var(--space-hair) var(--space-6)",
    borderRadius: "var(--radius-xs)",
    background: on
      ? "var(--color-status-go-bg)"
      : "var(--color-surface-raised)",
    color: on ? "var(--color-status-go-fg)" : "var(--color-text-faint)",
  };
}

const BODY: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-8)",
  marginTop: "var(--space-8)",
  flex: 1,
  minHeight: 0,
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
  gap: "var(--space-4)",
  flex: 1,
  justifyContent: "center",
};

const READOUT_ROW: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-8)",
};

const READOUT_LABEL: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.12em",
  color: "var(--color-text-faint)",
  minWidth: "28px",
};

const READOUT_VALUE: CSSProperties = {
  // Off the type scale: the scale stops at --font-size-lg (16px) and this is a
  // display-tier readout.
  fontSize: "18px",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "0.04em",
};

const THROTTLE_COLUMN: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--space-4)",
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
  gap: "var(--space-8)",
  paddingTop: "var(--space-6)",
  borderTop: "1px solid var(--color-surface-raised)",
};

const BANNER: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-status-warning-bg)",
  padding: "var(--space-4) var(--space-6)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-status-warning-bg)",
  borderRadius: "var(--radius-xs)",
};

const GROUP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
};

const GROUP_LABEL: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
};

const BUTTON_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(48px, 1fr))",
  gap: "var(--space-4)",
};

const SLIDER_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-8)",
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
  gap: "var(--space-8)",
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
    "Attitude indicator + control surface. Reads heading/pitch/roll from Telemachus's n.* bucket and exposes a deep action surface (every SAS mode, throttle, fly-by-wire pitch/yaw/roll, RCS translation and trim) so a hardware stick mapped via the Inputs tab can fly the vessel.",
  tags: ["telemetry", "control"],
  defaultSize: { w: 8, h: 11 },
  minSize: { w: 3, h: 4 },
  component: NavballComponent,
  configComponent: NavballConfigComponent,
  // n.heading2/n.pitch2/n.roll2 (root-part frame) are mapped on
  // the wire now: VesselAttitude carries a genuinely distinct second frame,
  // see map-topic.ts's TELEMACHUS_CLEAN_HOMES. v.angleToPrograde stays
  // dropped from this declared list: a permanent gap on the new mod wire
  // with no planned replacement (map-topic.ts's TELEMACHUS_KNOWN_GAPS):
  // it was never actually read by this widget anyway.
  dataRequirements: [
    "n.heading",
    "n.pitch",
    "n.roll",
    "n.heading2",
    "n.pitch2",
    "n.roll2",
    "f.sasMode",
    "f.sasEnabled",
    "f.precisionControl",
    "v.rcsValue",
    "f.throttle",
    "v.isControllable",
    "comm.signalDelay",
  ],
  defaultConfig: { useCoMFrame: false, controlMode: false },
  actions: navballActions,
  // Header badge slot for an autopilot (MechJeb-alike) active-mode indicator
  // alongside the SAS/RCS badges. Unfilled until an Uplink registers an augment;
  // see the `SlotRegistry` merge above and augment-slot-map.md.
  augmentSlots: ["navball.badges"],
  pushable: true,
  requires: ["flight"],
});

export { NavballComponent };
