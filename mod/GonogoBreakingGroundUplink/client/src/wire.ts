import { magnitudeOf } from "@ksp-gonogo/ui-kit";

/**
 * The magnitude, or `null` for anything the mod withheld.
 * Takes a `Value` as well as a bare number, since a declared quantity arrives wrapped; the finiteness rule stays {@link magnitudeOf}'s.
 */
export function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return magnitudeOf(v);
  if (typeof v === "object" && v !== null && "magnitude" in v) {
    const { magnitude } = v;
    return typeof magnitude === "number" ? magnitudeOf({ magnitude }) : null;
  }
  return null;
}

/** The magnitude, or a required `fallback`; a caller that cannot name a safe substitute wants {@link numOrNull}. */
export function num(v: unknown, fallback: number): number {
  return numOrNull(v) ?? fallback;
}

/** A wire flag, or `null` when the mod withheld it: a false is a definite claim about the craft. */
export function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
