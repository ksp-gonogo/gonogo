import { useSyncExternalStore } from "react";
import type { FlightPlan } from "./plan";

/*
 * Interim store: the saved plans live in this screen's browser until the mod
 * keeps them in the game install and copies the applied plan into the save.
 * The widget reads through `useFlightPlan` only, so the source can move without
 * touching it.
 */
const KEY = "gonogo.flightPlans";
const APPLIED_KEY = "gonogo.flightPlans.applied";
const APPLIED_AT_KEY = "gonogo.flightPlans.editorAppliedAt";
const listeners = new Set<() => void>();
let cache: readonly FlightPlan[] | undefined;

function read(): readonly FlightPlan[] {
  if (cache) return cache;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as FlightPlan[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(plans: readonly FlightPlan[]): void {
  cache = plans;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(plans));
  } catch {
    // A refused write leaves the plans in memory for this session.
  }
  for (const l of listeners) l();
}

/** Saves a plan, replacing one with the same id. */
export function savePlan(plan: FlightPlan): void {
  write([...read().filter((p) => p.id !== plan.id), plan]);
}

export function removePlan(id: string): void {
  write(read().filter((p) => p.id !== id));
}

/** For tests: forget the cached list so the next read comes from storage. */
export function resetPlanStoreCache(): void {
  cache = undefined;
  appliedCache = undefined;
  editorAppliedAtCache = undefined;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Every saved plan, in the order saved. */
export function useFlightPlans(): readonly FlightPlan[] {
  return useSyncExternalStore(subscribe, read, read);
}

/** The saved plan with this id, or `undefined`. */
export function useFlightPlan(id: string | undefined): FlightPlan | undefined {
  const plans = useFlightPlans();
  return id === undefined ? undefined : plans.find((p) => p.id === id);
}

let appliedCache: Readonly<Record<string, string>> | undefined;

function readApplied(): Readonly<Record<string, string>> {
  if (appliedCache) return appliedCache;
  try {
    const raw = globalThis.localStorage?.getItem(APPLIED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    appliedCache =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, string>)
        : {};
  } catch {
    appliedCache = {};
  }
  return appliedCache;
}

/**
 * Applies a plan to a craft: the vessel id in flight, or `"editor"` for the
 * craft in the editor. `undefined` takes the plan off. `atUt` is the game time
 * of a plan applied in the editor, which lets it pass to a craft launched
 * after it.
 */
export function applyPlan(
  craft: string,
  planId: string | undefined,
  atUt?: number,
): void {
  const next = { ...readApplied() };
  if (planId === undefined) delete next[craft];
  else next[craft] = planId;
  if (craft === EDITOR) {
    writeEditorAppliedAt(
      planId !== undefined && atUt !== undefined && Number.isFinite(atUt)
        ? atUt
        : undefined,
    );
  }
  writeApplied(next);
}

/** What the game says of a vessel in flight that may be the craft just launched from the editor. */
export interface LaunchedCraft {
  vesselId: string;
  onPad: boolean;
  /** When it left the pad, in UT seconds; `undefined` while it is still on it. */
  launchUt: number | undefined;
}

/**
 * Moves the plan applied in the editor to the craft launched from it: a
 * vessel on the pad, or one that left the pad at or after the plan was
 * applied. A vessel that already has a plan keeps it. Returns whether it
 * moved one.
 */
export function carryEditorPlan(craft: LaunchedCraft): boolean {
  const applied = readApplied();
  const planId = applied[EDITOR];
  if (planId === undefined || applied[craft.vesselId] !== undefined) {
    return false;
  }
  const appliedAt = readEditorAppliedAt();
  const launchedSince =
    craft.launchUt !== undefined &&
    appliedAt !== undefined &&
    craft.launchUt >= appliedAt;
  if (!craft.onPad && !launchedSince) return false;
  const { [EDITOR]: _, ...rest } = applied;
  writeEditorAppliedAt(undefined);
  writeApplied({ ...rest, [craft.vesselId]: planId });
  return true;
}

/** The key a plan applied in the editor is kept under. */
export const EDITOR = "editor";

let editorAppliedAtCache: { ut: number | undefined } | undefined;

function readEditorAppliedAt(): number | undefined {
  if (editorAppliedAtCache) return editorAppliedAtCache.ut;
  let ut: number | undefined;
  try {
    const raw = globalThis.localStorage?.getItem(APPLIED_AT_KEY);
    const parsed = raw == null ? Number.NaN : Number(raw);
    ut = Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    ut = undefined;
  }
  editorAppliedAtCache = { ut };
  return ut;
}

function writeEditorAppliedAt(ut: number | undefined): void {
  editorAppliedAtCache = { ut };
  try {
    if (ut === undefined) globalThis.localStorage?.removeItem(APPLIED_AT_KEY);
    else globalThis.localStorage?.setItem(APPLIED_AT_KEY, String(ut));
  } catch {
    // Kept for this session only.
  }
}

function writeApplied(next: Readonly<Record<string, string>>): void {
  appliedCache = next;
  try {
    globalThis.localStorage?.setItem(APPLIED_KEY, JSON.stringify(next));
  } catch {
    // Applied for this session only.
  }
  for (const l of listeners) l();
}

/** The id of the plan applied to `craft`, or `undefined`. */
export function useAppliedPlanId(
  craft: string | undefined,
): string | undefined {
  const applied = useSyncExternalStore(subscribe, readApplied, readApplied);
  return craft === undefined ? undefined : applied[craft];
}
