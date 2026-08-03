/**
 * Pure, React-free math for the continuous-control delay stream. The hook
 * (`use-control-stream.tsx`) owns the timers, rings and dispatch; the component
 * (`ControlDelayStream`) owns the pixels; everything numeric lives here so it is
 * asserted directly with no harness. See
 * `local_docs/design/specs/2026-08-02-continuous-control-delay-stream-design.md`.
 */

export type ControlRange = "unit" | "signed";

export interface ControlSample {
  /** Seconds since the value was issued: 0 = now (left edge), increasing rightward. */
  age: number;
  /** Value mapped into the shared 0..1 band. */
  value: number;
}

export interface LoggedSample {
  /** UT the sample was stamped at: issued (commands) or received (readback). */
  atUt: number;
  /** Already mapped into the shared 0..1 band. */
  value: number;
}

/**
 * Below this one-way delay the round-trip pipe is imperceptible and the strip
 * renders nothing (direct/LOS control pays zero). 50 ms one-way is ~100 ms round
 * trip, under a single rendered frame at this short height.
 */
export const MIN_DELAY_SECONDS = 0.05;

/**
 * Confirmed-zone divergence smaller than this (of the 0..1 band) reads as line
 * thickness, not signal, so it is not drawn as a deviation. 0.02 sits just under
 * one stroke width at the sparkline's short height.
 */
export const DEVIATION_EPSILON = 0.02;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Map a raw control value into the shared 0..1 band. `unit` passes 0..1 through
 * (throttle); `signed` maps -1..1 so neutral (0) sits at 0.5, the mid band the
 * design mandates for signed axes (pitch/yaw/roll). Normalisation is DISPLAY
 * only: the hook dispatches the raw value, never this.
 */
export function normalize01(value: number, range: ControlRange): number {
  if (!Number.isFinite(value)) return 0;
  return range === "signed" ? clamp01((value + 1) / 2) : clamp01(value);
}

/**
 * Ring cap: a short-height sparkline is sub-pixel well before this many
 * points. Exported so both `recordSample` below and the hook's span-based
 * `trim` share ONE ring-bounding rule.
 */
export const MAX_SAMPLES = 600;

/**
 * Push `sample` onto `ring` and immediately cap it at `MAX_SAMPLES`,
 * unconditionally, independent of delay state, span, or whether/when a
 * caller ever re-derives the strip. This is what keeps `commandRing`/
 * `readbackRing` (`use-control-stream.tsx`) bounded on EVERY coalesced
 * tick, even while a widget sits on a direct/low-delay link, where the
 * span-based eviction below is never reached (that branch early-returns
 * before ever looking at the rings, so a cap that only lived there let the
 * rings grow forever on a direct link).
 */
export function recordSample(ring: LoggedSample[], sample: LoggedSample): void {
  ring.push(sample);
  while (ring.length > MAX_SAMPLES) ring.shift();
}

/**
 * Whether `raw` moved past `deadband` since `lastRaw`, measured in the
 * shared 0..1 band (both values normalised first), not in raw units. A raw
 * delta means something different per `range`: a `signed` axis (-1..1)
 * halves a raw delta relative to a `unit` axis (0..1) covering the same
 * visible distance, so comparing raw deltas against one deadband constant
 * makes the effective deadband range-dependent. Normalising both sides
 * first keeps the deadband's meaning ("of the 0..1 band") consistent
 * across axes.
 */
export function exceedsDeadband(
  raw: number,
  lastRaw: number,
  range: ControlRange,
  deadband: number,
): boolean {
  return (
    Math.abs(normalize01(raw, range) - normalize01(lastRaw, range)) > deadband
  );
}

export interface DeriveStripArgs {
  commandLog: readonly LoggedSample[];
  readbackLog: readonly LoggedSample[];
  nowUt: number;
  oneWaySeconds: number;
}

export interface DerivedStrip {
  inTransit: ControlSample[];
  echo: ControlSample[];
}

/**
 * Turn the raw command + readback rings into the two age-indexed sample arrays
 * the sparkline draws, now-left / age-right. The strip spans 3*T: a command ages
 * 0..T (outgoing), T..2T (echo inbound), 2T..3T (confirmed). A readback RECEIVED
 * at UT r reflects the command issued at r - 2T, so it lands at age (nowUt-r)+2T,
 * i.e. the last T of received readback fills the confirmed zone [2T, 3T].
 */
export function deriveStrip({
  commandLog,
  readbackLog,
  nowUt,
  oneWaySeconds,
}: DeriveStripArgs): DerivedStrip {
  const span = 3 * oneWaySeconds;
  const inTransit: ControlSample[] = [];
  for (const s of commandLog) {
    const age = nowUt - s.atUt;
    if (age < 0 || age > span) continue;
    inTransit.push({ age, value: s.value });
  }
  inTransit.sort((a, b) => a.age - b.age);

  const echo: ControlSample[] = [];
  for (const s of readbackLog) {
    const age = nowUt - s.atUt + 2 * oneWaySeconds;
    if (age < 2 * oneWaySeconds || age > span) continue;
    echo.push({ age, value: s.value });
  }
  echo.sort((a, b) => a.age - b.age);

  return { inTransit, echo };
}

/**
 * Commanded value linearly interpolated at `age` from the (age-ascending)
 * inTransit samples, for deviation comparison in the confirmed zone. `null` when
 * there is no commanded path to read.
 */
export function commandedAt(
  inTransit: readonly ControlSample[],
  age: number,
): number | null {
  if (inTransit.length === 0) return null;
  const first = inTransit[0];
  const last = inTransit[inTransit.length - 1];
  if (age <= first.age) return first.value;
  if (age >= last.age) return last.value;
  for (let i = 1; i < inTransit.length; i++) {
    const b = inTransit[i];
    if (age <= b.age) {
      const a = inTransit[i - 1];
      const t = (age - a.age) / (b.age - a.age || 1);
      return a.value + t * (b.value - a.value);
    }
  }
  return last.value;
}

/** True when the echo has diverged from the commanded path past the epsilon anywhere in the confirmed zone. */
export function hasDeviation(
  inTransit: readonly ControlSample[],
  echo: readonly ControlSample[],
): boolean {
  for (const e of echo) {
    const c = commandedAt(inTransit, e.age);
    if (c !== null && Math.abs(e.value - c) > DEVIATION_EPSILON) return true;
  }
  return false;
}
