import { boolOrNull, numOrNull } from "../wire";

export const ROTOR_MAX_RPM = 460; // ModuleRoboticServoRotor.rpmLimit range ceiling.
export const RPM_STEP = 10;
export const TORQUE_STEP = 10;

/**
 * One rotor as this widget draws it.
 * Every figure is `null` when withheld: zero RPM is a stopped rotor, and the steppers command from these numbers.
 */
export interface RotorInfo {
  /**
   * Position in `robotics.servos` as delivered, not in the parsed list (the parse
   * drops non-rotor servos and entries without a `partId`), so a displayed figure
   * can be read back as a field reading with its currency. The numeric fields
   * below stay bare because the steppers command from them.
   */
  srcIndex: number;
  partId: string;
  name: string;
  rpm: number | null;
  rpmLimit: number | null;
  torqueLimit: number | null;
  maxTorque: number | null;
  brakePercentage: number | null;
  /** Unknown is never false: each false is a definite claim about the rotor. */
  motorEngaged: boolean | null;
  locked: boolean | null;
  counterClockwise: boolean | null;
  output: number | null;
}

/**
 * Parses `robotics.servos` down to its rotors.
 * `partId` is the stringified `Part.flightID`, unique even among symmetric same-named parts; an entry without one cannot be targeted and is dropped.
 */
export function parseRotors(raw: unknown): RotorInfo[] {
  if (!Array.isArray(raw)) return [];
  const entries: unknown[] = raw;
  const out: RotorInfo[] = [];
  // `srcIndex` is the position in the delivered array, which the `continue`s make differ from the output position.
  for (const [srcIndex, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== "rotor") continue;
    if (typeof e.partId !== "string") continue;
    out.push({
      srcIndex,
      partId: e.partId,
      name: typeof e.partName === "string" ? e.partName : `Rotor ${e.partId}`,
      rpm: numOrNull(e.currentRPM),
      rpmLimit: numOrNull(e.rpmLimit),
      torqueLimit: numOrNull(e.servoMotorLimit),
      maxTorque: numOrNull(e.maxTorque),
      brakePercentage: numOrNull(e.brakePercentage),
      motorEngaged: boolOrNull(e.servoMotorIsEngaged),
      locked: boolOrNull(e.servoIsLocked),
      counterClockwise: boolOrNull(e.counterClockwise),
      output: numOrNull(e.normalizedOutput),
    });
  }
  return out;
}

export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
