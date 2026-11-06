import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import type { DialZone } from "@ksp-gonogo/ui-kit";

/**
 * Thrust over weight at a body's surface gravity, in m/s². Kilonewtons over
 * tonnes is newtons over kilograms, so the ratio needs no conversion. `null`
 * without a positive mass or a positive gravity: a missing gravity is not
 * Kerbin's.
 */
export function twrOf(
  thrust: number,
  mass: number,
  gravity: number | undefined,
): number | null {
  if (gravity === undefined || !(gravity > 0) || !(mass > 0)) return null;
  return thrust / (mass * gravity);
}

// Lift-off TWR sits around 1.5-2.5; anything above 3 pins the dial, which still reads as "very high".
export const GAUGE_MIN = value("1", 0);
export const GAUGE_MAX = value("1", 3);

export const ZONES: DialZone<"1">[] = [
  {
    from: value("1", 0),
    to: value("1", 1),
    color: "var(--color-nogo-mark)",
  },
  {
    from: value("1", 1),
    to: value("1", 1.5),
    color: "var(--color-warn-mark)",
  },
  { from: value("1", 1.5), to: value("1", 3), color: "var(--color-accent-fg)" },
];

export const GAUGE_BANDS = [
  { from: value("1", 0), to: value("1", 1), tone: "nogo" },
  { from: value("1", 1), to: value("1", 1.5), tone: "warn" },
  { from: value("1", 1.5), to: value("1", 3), tone: "go" },
] as const;

type Tone = "ok" | "warn" | "lost";

const TONE_COLOR: Record<Tone, string> = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-warn-mark)",
  lost: "var(--color-nogo-mark)",
};

function toneFor(twr: Value<"1">): Tone {
  if (twr.lessThan(1)) return "lost";
  if (twr.lessThan(1.5)) return "warn";
  return "ok";
}

export function toneColorFor(twr: Value<"1">): string {
  return TONE_COLOR[toneFor(twr)];
}
