import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

export function formatReadoutValue(v: number): string {
  if (!Number.isFinite(v)) return NULL_DISPLAY;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(v / 1_000).toFixed(1)}k`;
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

function numericTickText(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

export function formatNumericTick(v: number, unit?: string): string {
  const text = numericTickText(v);
  return unit ? `${text}${unit}` : text;
}
