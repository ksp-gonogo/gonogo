import { PerfBudget, useTelemetry } from "@ksp-gonogo/core";
import {
  type ControlStream,
  getActiveTimelineEpoch,
  useControlStream,
  useLatestValue,
  useUtNow,
} from "@ksp-gonogo/sitrep-client";
import {
  type ValueCommandQueueLike,
  value,
  valueCommandState,
} from "@ksp-gonogo/sitrep-sdk";
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

/**
 * Seconds past the round trip that this screen's own input stays the one a step
 * works from, so a step on a direct link still builds on the input before it.
 */
const IN_FLIGHT_SLACK_SECONDS = 2;

/*
 * The commanded throttle tracks the readback until the operator first touches
 * it, and the stream commands nothing until then: neither a 0 seeded from an
 * unread readback nor, under delay, a round-trip-old readback sent back at the
 * craft. A vessel switch, a rise of the timeline epoch or the game clock going
 * back (a quickload or revert) re-arms the latch.
 *
 * What the operator reads is the craft's throttle. A step (±10%, a bound key)
 * works from the newest input still on its way to the craft, from this screen
 * or another at the centre, and from the craft's throttle once none is.
 */
export function useThrottleCommand(throttle: number | null): {
  throttleCmd: number;
  setThrottleCmd: ThrottleSetter;
  /** The value a step works from: the newest input in flight, else the craft's throttle; `null` while there is neither. */
  throttleBase: number | null;
  /** The throttle the craft is expected to hold now, given every input that has reached it; `null` while there is neither an input nor a reading. */
  throttleExpected: number | null;
  /** With neither a readback nor a command, a 10% step would be a step from a guess. */
  throttleKnown: boolean;
  throttleStream: ControlStream;
} {
  const [throttleCmd, setThrottleCmdState] = useState(throttle ?? 0);
  const throttleCmdRef = useRef(throttleCmd);
  throttleCmdRef.current = throttleCmd;
  const throttleTouchedRef = useRef(false);
  // State as well as the ref: a first touch to the value already held changes nothing else, and the stream learns of it only through a render.
  const [throttleTouched, setThrottleTouched] = useState(false);
  // When this screen last set the throttle, in UT; null once that input is no longer the newest in flight.
  const changedAtUtRef = useRef<number | null>(null);
  // The newest input the queue listed when this screen last set the throttle.
  const queuedAtChangeRef = useRef(Number.NEGATIVE_INFINITY);
  const nowUt = useUtNow() ?? 0;
  useEffect(() => {
    if (!throttleTouchedRef.current) setThrottleCmdState(throttle ?? 0);
  }, [throttle]);
  // An id does not decay, so a held one still names the vessel.
  const activeVesselId = lastObserved(
    useTelemetry("vessel.identity"),
  )?.vesselId;
  const prevVesselIdRef = useRef(activeVesselId);
  useEffect(() => {
    if (activeVesselId === prevVesselIdRef.current) return;
    prevVesselIdRef.current = activeVesselId;
    throttleTouchedRef.current = false;
    changedAtUtRef.current = null;
    setThrottleTouched(false);
    // Re-seed here: the new vessel's throttle may have landed in the same frame, so the `throttle` effect may not fire again.
    setThrottleCmdState(throttle ?? 0);
  }, [activeVesselId, throttle]);
  const epochRef = useRef(getActiveTimelineEpoch());
  useEffect(() => {
    const active = getActiveTimelineEpoch();
    const prior = epochRef.current;
    epochRef.current = active;
    const epochRose =
      active !== undefined &&
      prior !== undefined &&
      active.store === prior.store &&
      active.epoch > prior.epoch;
    const clockWentBack =
      changedAtUtRef.current !== null && nowUt < changedAtUtRef.current;
    if (!epochRose && !clockWentBack) return;
    throttleTouchedRef.current = false;
    changedAtUtRef.current = null;
    setThrottleTouched(false);
    setThrottleCmdState(throttle ?? 0);
  }, [nowUt, throttle]);
  const throttleStream = useControlStream(
    "vessel.control.throttle",
    throttleTouched ? throttleCmd : null,
    {
      label: "Throttle",
      range: "unit",
      onDispatch: () => CONTROL_STREAM_BUDGET.record(),
    },
  );

  const { queued, oneWaySeconds, resend } = throttleStream;
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  /*
   * An input from another screen, listed after this screen's last change, has
   * replaced it. Listed after, rather than sent after: the queue's dispatch
   * times are the centre's clock and this screen's change is stamped on its
   * own, so comparing the two can pass either way.
   */
  if (
    changedAtUtRef.current !== null &&
    queued !== null &&
    queued.atUt > queuedAtChangeRef.current &&
    Math.abs(queued.value - throttleCmd) > SAME_THROTTLE
  ) {
    changedAtUtRef.current = null;
  }
  const ownInFlight =
    changedAtUtRef.current !== null &&
    nowUt - changedAtUtRef.current <=
      2 * (oneWaySeconds ?? 0) + IN_FLIGHT_SLACK_SECONDS;
  const throttleBase = ownInFlight
    ? throttleCmd
    : queued !== null
      ? queued.value
      : throttle;
  const queue = useLatestValue<ValueCommandQueueLike>("system.uplink.pending");
  const { expected: throttleExpected } = valueCommandState(
    "vessel.control.setThrottle",
    {
      received: throttle,
      own:
        ownInFlight && changedAtUtRef.current !== null
          ? { value: throttleCmd, at: value("ut", changedAtUtRef.current) }
          : null,
    },
    queue,
    oneWaySeconds === null ? null : value("s", oneWaySeconds),
    value("ut", nowUt),
  );
  const baseRef = useRef(throttleBase);
  baseRef.current = throttleBase;
  const nowUtRef = useRef(nowUt);
  nowUtRef.current = nowUt;

  const setThrottleCmd: ThrottleSetter = (next) => {
    // A step lands on a whole ten-thousandth, so ten 10% steps reach exactly full rather than a float's error short of it.
    const resolved =
      typeof next === "function"
        ? Math.round(next(baseRef.current ?? throttleCmdRef.current) * 1e4) /
          1e4
        : next;
    // The stream sends only a change, so the value it last sent, pressed again after another screen moved the craft, is sent on purpose.
    if (Math.abs(resolved - throttleCmdRef.current) <= SAME_THROTTLE) resend();
    throttleTouchedRef.current = true;
    changedAtUtRef.current = nowUtRef.current;
    queuedAtChangeRef.current =
      queuedRef.current?.atUt ?? Number.NEGATIVE_INFINITY;
    baseRef.current = resolved;
    throttleCmdRef.current = resolved;
    setThrottleTouched(true);
    setThrottleCmdState(resolved);
  };
  return {
    throttleCmd,
    setThrottleCmd,
    throttleBase,
    throttleExpected,
    throttleKnown: throttleTouched || throttle !== null,
    throttleStream,
  };
}

/** Two throttle values closer than this are the same command, as the stream's own deadband counts them. */
const SAME_THROTTLE = 0.005;

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
