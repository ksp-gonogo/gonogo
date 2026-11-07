import {
  combineReadings,
  type Reading,
  type Value,
  type Vec3Of,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { bare } from "../shared/dockAngles";

/** One axis of the craft's orbit frame, as the target sits along it and drifts along it. */
export interface OrbitFrameAxis {
  key: "alongTrack" | "radial" | "normal";
  /** The side the target is on, in the words an operator flying the orbit uses. */
  word: string;
  /** Which way the offset counts as positive, for the hover. */
  positive: string;
  /** How far along the axis the target is, always positive: the word carries the side. */
  offset: Reading<Value<"m">>;
  /** How fast the offset changes, always positive: `closing` carries the direction. */
  rate: Reading<Value<"m/s">>;
  /** The size of the rate in metres per second, for choosing how many places to print. */
  rateSize: number;
  /** Metres per second the target is nearing the craft's own position along this axis, negative while moving off; undefined where the offset is too small to have a side. */
  closing: number | undefined;
}

/** Inside this offset, metres, the target is level with the craft on the axis and has no side to be on. */
const LEVEL_WITHIN_M = 0.5;

/** A vector in the craft's orbit frame, by axis. */
export interface OrbitComponents {
  radial: number;
  alongTrack: number;
  normal: number;
}

interface AxisSpec {
  key: OrbitFrameAxis["key"];
  positiveWord: string;
  negativeWord: string;
  positive: string;
}

/*
 * The frame is right-handed with the craft's height as its first axis, so
 * looking along the orbit with the body below, the angular momentum (normal)
 * points to the left.
 */
const AXES: readonly AxisSpec[] = [
  {
    key: "alongTrack",
    positiveWord: "Ahead",
    negativeWord: "Behind",
    positive: "Ahead is along the craft's orbit",
  },
  {
    key: "radial",
    positiveWord: "Above",
    negativeWord: "Below",
    positive: "Above is away from the body",
  },
  {
    key: "normal",
    positiveWord: "Left",
    negativeWord: "Right",
    positive:
      "Left is along the orbit's normal, facing along the orbit with the body below",
  },
];

/**
 * The target's offset from the craft along the craft's orbit, and its rate, one
 * entry per axis; undefined while either reading carries no value. The
 * readings give each figure its currency, and `offset` and `rate` are the same
 * vectors as plain numbers by axis.
 */
export function orbitFrameAxes(
  position: Reading<Vec3Of<"m">>,
  velocity: Reading<Vec3Of<"m/s">>,
  offset: OrbitComponents | undefined,
  rate: OrbitComponents | undefined,
): OrbitFrameAxis[] | undefined {
  if (offset === undefined || rate === undefined) return undefined;
  return AXES.map((axis) => {
    const at = offset[axis.key];
    const speed = rate[axis.key];
    const level = Math.abs(at) < LEVEL_WITHIN_M;
    return {
      key: axis.key,
      word: at >= 0 || level ? axis.positiveWord : axis.negativeWord,
      positive: axis.positive,
      offset: combineReadings([position], () => value("m", Math.abs(at))),
      rate: combineReadings([velocity], () => value("m/s", Math.abs(speed))),
      rateSize: Math.abs(speed),
      closing: level ? undefined : at > 0 ? -speed : speed,
    };
  });
}

/**
 * How you are drifting past the target, in the target's orbit-frame axes as the
 * approach drawing uses them (radial out, along-track forward), metres per
 * second. The wire carries the target's motion relative to you, so this is its
 * negation. The two craft's frames differ by the angle the range spans at the
 * orbit's radius, under a degree inside the approach range.
 */
export function drift(
  velocity: Reading<Vec3Of<"m/s">>,
  position: Reading<Vec3Of<"m">>,
): { radial: number; alongTrack: number } | undefined {
  if (position.state !== "observed" || velocity.state !== "observed") {
    return undefined;
  }
  if (position.value == null || velocity.value == null) return undefined;
  const v = bare(velocity.value);
  const neg = (n: number) => (n === 0 ? 0 : -n);
  return { radial: neg(v.x), alongTrack: neg(v.y) };
}
