import { PerfBudget } from "@ksp-gonogo/core";
import type { Tone as KitTone } from "@ksp-gonogo/sitrep-sdk";

export interface BudgetSnapshot {
  name: string;
  rate: number;
  threshold: number;
  windowMs: number;
  unit: string;
  exceedanceCount: number;
}

export type Tone = "under" | "near" | "over";

export function readSnapshots(): BudgetSnapshot[] {
  return PerfBudget.getAll().map((b) => ({
    name: b.name,
    rate: b.rate(),
    threshold: b.threshold,
    windowMs: b.windowMs,
    unit: b.unit,
    exceedanceCount: b.getExceedanceCount(),
  }));
}

export function formatRate(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

export function ratioOf(s: BudgetSnapshot): number {
  return s.threshold > 0 ? s.rate / s.threshold : 0;
}

export function toneOf(s: BudgetSnapshot): Tone {
  const ratio = ratioOf(s);
  if (ratio >= 1) return "over";
  if (ratio >= 0.75) return "near";
  return "under";
}

/** This widget's budget tones, mapped onto the kit's tone vocabulary. */
export const KIT_TONE: Record<Tone, KitTone> = {
  under: "go",
  near: "warn",
  over: "nogo",
};

export const TONE_COLOR: Record<Tone, string> = {
  under: "var(--color-accent-fg)",
  near: "var(--color-warn-mark)",
  over: "var(--color-nogo-mark)",
};
