import { useActionInput } from "@ksp-gonogo/core";
import type { NavballActions } from "./config";
import type { AxisSetters, ThrottleSetter } from "./controlStreams";
import { analogValue, clamp, isButtonPress } from "./input";
import type { SasMode } from "./sasModes";

export type TrimField = "pitchTrim" | "yawTrim" | "rollTrim";

/** Binds every Navball action to its handler; buttons fire on the press edge only, so a hardware press-and-release does not trigger twice. */
export function useNavballInputs({
  toggleControlMode,
  armFbw,
  disarmFbw,
  toggleSas,
  toggleRcs,
  setSasMode,
  setThrottleCmd,
  throttleKnown,
  setAxis,
  sendTrim,
}: {
  toggleControlMode: () => void;
  armFbw: () => void;
  disarmFbw: () => void;
  toggleSas: () => void;
  toggleRcs: () => void;
  setSasMode: (mode: SasMode) => void;
  setThrottleCmd: ThrottleSetter;
  throttleKnown: boolean;
  setAxis: AxisSetters;
  sendTrim: (field: TrimField, raw: number) => void;
}) {
  useActionInput<NavballActions>({
    "take-control": (payload) => {
      if (!isButtonPress(payload)) return;
      toggleControlMode();
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
    "set-pitch": (p) => withAnalog(p, -1, 1, setAxis.setPitch),
    "set-yaw": (p) => withAnalog(p, -1, 1, setAxis.setYaw),
    "set-roll": (p) => withAnalog(p, -1, 1, setAxis.setRoll),
    "translate-x": (p) => withAnalog(p, -1, 1, setAxis.setTranslateX),
    "translate-y": (p) => withAnalog(p, -1, 1, setAxis.setTranslateY),
    "translate-z": (p) => withAnalog(p, -1, 1, setAxis.setTranslateZ),
    "set-pitch-trim": (p) =>
      withAnalog(p, -1, 1, (v) => sendTrim("pitchTrim", v)),
    "set-yaw-trim": (p) => withAnalog(p, -1, 1, (v) => sendTrim("yawTrim", v)),
    "set-roll-trim": (p) =>
      withAnalog(p, -1, 1, (v) => sendTrim("rollTrim", v)),
  });
}

function withAnalog(
  p: { kind: string; value: unknown },
  lo: number,
  hi: number,
  apply: (v: number) => void,
): void {
  const v = analogValue(p, lo, hi);
  if (v !== null) apply(v);
}
