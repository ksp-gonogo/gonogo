import { STANDARD_GRAVITY, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import type { GaugeZone } from "@ksp-gonogo/ui";

/**
 * Thrust over weight at standard gravity: kilonewtons over tonnes is newtons
 * over kilograms, so the ratio needs no conversion. `null` without a positive
 * mass.
 */
export function twrOf(thrust: number, mass: number): number | null {
  return mass > 0 ? thrust / (mass * STANDARD_GRAVITY) : null;
}

// Lift-off TWR sits around 1.5-2.5; anything above 3 pins the dial, which still reads as "very high".
export const GAUGE_MIN = value("1", 0);
export const GAUGE_MAX = value("1", 3);

export const ZONES: GaugeZone<"1">[] = [
  {
    from: value("1", 0),
    to: value("1", 1),
    color: "var(--color-status-nogo-bg)",
  },
  {
    from: value("1", 1),
    to: value("1", 1.5),
    color: "var(--color-status-warning-bg)",
  },
  { from: value("1", 1.5), to: value("1", 3), color: "var(--color-accent-fg)" },
];

type Tone = "ok" | "warn" | "lost";

const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-bg)",
  lost: "var(--color-status-nogo-bg)",
};

function toneFor(twr: Value<"1">): Tone {
  if (twr.lessThan(1)) return "lost";
  if (twr.lessThan(1.5)) return "warn";
  return "ok";
}

export function toneColorFor(twr: Value<"1">): string {
  return TONE_COLOR[toneFor(twr)];
}
