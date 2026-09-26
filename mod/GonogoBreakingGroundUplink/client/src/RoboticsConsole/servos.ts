import { boolOrNull, numOrNull } from "../wire";

/** A rotation servo behaves as a hinge here; the names differ only because the parts do. */
export type ServoType = "hinge" | "rotationServo" | "piston";

/**
 * One positioned joint as this console drives it.
 * Every figure is `null` when withheld, and `atTarget` is `null` whenever either input is, since the stepper steps from `target`.
 */
export interface ServoInfo {
  /** Position in `robotics.servos` as delivered, so a drawn figure can be read back as a field reading with its currency. */
  srcIndex: number;
  partId: string;
  name: string;
  type: ServoType;
  current: number | null;
  target: number | null;
  atTarget: boolean | null;
  /** Unknown is never false: the toggles send an absolute state computed by inverting these. */
  motorEngaged: boolean | null;
  locked: boolean | null;
  torqueLimit: number | null;
}

/** Per type, because a hinge steps in degrees and a piston in metres. */
export const TARGET_STEP: Record<ServoType, number> = {
  hinge: 5,
  rotationServo: 5,
  piston: 0.05,
};

/** At-target tolerance per type: half a degree for the angle kinds, a centimetre for a piston. */
const AT_TARGET_EPSILON: Record<ServoType, number> = {
  hinge: 0.5,
  rotationServo: 0.5,
  piston: 0.01,
};

/** A hinge reads in whole degrees; a piston in metres, which needs decimals. */
export const formatPos = (type: ServoType, v: number): string =>
  type === "piston" ? v.toFixed(2) : String(Math.round(v));

// A piston's extension is a length in metres, not a percentage.
export const unitFor = (type: ServoType) => (type === "piston" ? "m" : "°");

/** Decimals a drawn position carries: whole degrees, or centimetres of a piston's metres. */
export const positionDecimals = (type: ServoType): number =>
  type === "piston" ? 2 : 0;

/**
 * Parses `robotics.servos` down to the hinges, rotation servos and pistons this widget drives.
 * `partId` is the stringified `Part.flightID`, unique even among symmetric same-named parts; an entry without one cannot be targeted and is dropped.
 */
export function parseServos(raw: unknown): ServoInfo[] {
  if (!Array.isArray(raw)) return [];
  const entries: unknown[] = raw;
  const out: ServoInfo[] = [];
  for (const [srcIndex, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== "hinge" && e.type !== "rotationServo" && e.type !== "piston")
      continue;
    if (typeof e.partId !== "string") continue;
    const type: ServoType = e.type;
    const current = numOrNull(
      type === "piston" ? e.currentExtension : e.currentAngle,
    );
    const target = numOrNull(
      type === "piston" ? e.targetExtension : e.targetAngle,
    );
    out.push({
      srcIndex,
      partId: e.partId,
      name: typeof e.partName === "string" ? e.partName : `Servo ${e.partId}`,
      type,
      current,
      target,
      atTarget:
        current === null || target === null
          ? null
          : Math.abs(current - target) < AT_TARGET_EPSILON[type],
      motorEngaged: boolOrNull(e.servoMotorIsEngaged),
      locked: boolOrNull(e.servoIsLocked),
      torqueLimit: numOrNull(e.servoMotorLimit),
    });
  }
  return out;
}

/** The same joints off a list that has stopped arriving: every figure is held, but whether a joint is at its target is a judgement about now. */
export function withholdVerdicts(servos: ServoInfo[]): ServoInfo[] {
  return servos.map((s) => ({ ...s, atTarget: null }));
}
