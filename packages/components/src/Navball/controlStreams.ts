import { PerfBudget, useTelemetry } from "@ksp-gonogo/core";
import {
  type ControlStream,
  useControlStream,
} from "@ksp-gonogo/sitrep-client";
import { useEffect, useRef, useState } from "react";
import { lastObserved } from "./readings";

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

export type ThrottleSetter = (next: number | ((v: number) => number)) => void;

/*
 * The commanded throttle tracks the readback until the operator first touches
 * it, and the stream commands nothing until then: neither a 0 seeded from an
 * unread readback nor, under delay, a round-trip-old readback sent back at the
 * craft. A vessel switch re-arms the latch.
 */
export function useThrottleCommand(throttle: number | null): {
  throttleCmd: number;
  setThrottleCmd: ThrottleSetter;
  /** With neither a readback nor a command, a 10% step would be a step from a guess. */
  throttleKnown: boolean;
  throttleStream: ControlStream;
} {
  const [throttleCmd, setThrottleCmdState] = useState(throttle ?? 0);
  const throttleTouchedRef = useRef(false);
  // State as well as the ref: a first touch to the value already held changes nothing else, and the stream learns of it only through a render.
  const [throttleTouched, setThrottleTouched] = useState(false);
  useEffect(() => {
    if (!throttleTouchedRef.current) setThrottleCmdState(throttle ?? 0);
  }, [throttle]);
  const setThrottleCmd: ThrottleSetter = (next) => {
    throttleTouchedRef.current = true;
    setThrottleTouched(true);
    setThrottleCmdState(next);
  };
  // An id does not decay, so a held one still names the vessel.
  const activeVesselId = lastObserved(
    useTelemetry("vessel.identity"),
  )?.vesselId;
  const prevVesselIdRef = useRef(activeVesselId);
  useEffect(() => {
    if (activeVesselId === prevVesselIdRef.current) return;
    prevVesselIdRef.current = activeVesselId;
    throttleTouchedRef.current = false;
    setThrottleTouched(false);
    // Re-seed here: the new vessel's throttle may have landed in the same frame, so the `throttle` effect may not fire again.
    setThrottleCmdState(throttle ?? 0);
  }, [activeVesselId, throttle]);
  const throttleStream = useControlStream(
    "vessel.control.throttle",
    throttleTouched ? throttleCmd : null,
    {
      label: "Throttle",
      range: "unit",
      onDispatch: () => CONTROL_STREAM_BUDGET.record(),
    },
  );
  return {
    throttleCmd,
    setThrottleCmd,
    throttleKnown: throttleTouched || throttle !== null,
    throttleStream,
  };
}

export type AxisSetter = (v: number) => void;

export interface AxisSetters {
  setPitch: AxisSetter;
  setYaw: AxisSetter;
  setRoll: AxisSetter;
  setTranslateX: AxisSetter;
  setTranslateY: AxisSetter;
  setTranslateZ: AxisSetter;
}

const axisStreamOpts = (label: string) => ({
  label,
  range: "signed" as const,
  onDispatch: () => CONTROL_STREAM_BUDGET.record(),
});

// KSP re-zeroes a raw axis every physics frame, so each fly-by-wire axis is a control stream, not a one-shot command.
export function useAxisStreams(): {
  axisStreams: ControlStream[];
  setAxis: AxisSetters;
} {
  const [pitchCmd, setPitchCmd] = useState<number | null>(null);
  const [yawCmd, setYawCmd] = useState<number | null>(null);
  const [rollCmd, setRollCmd] = useState<number | null>(null);
  const [translateXCmd, setTranslateXCmd] = useState<number | null>(null);
  const [translateYCmd, setTranslateYCmd] = useState<number | null>(null);
  const [translateZCmd, setTranslateZCmd] = useState<number | null>(null);
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
  return {
    axisStreams: [
      pitchStream,
      yawStream,
      rollStream,
      translateXStream,
      translateYStream,
      translateZStream,
    ],
    setAxis: {
      setPitch: setPitchCmd,
      setYaw: setYawCmd,
      setRoll: setRollCmd,
      setTranslateX: setTranslateXCmd,
      setTranslateY: setTranslateYCmd,
      setTranslateZ: setTranslateZCmd,
    },
  };
}
