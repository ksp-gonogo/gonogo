import type { DataRateTier } from "@ksp-gonogo/sitrep-sdk";

/** The setting's id. */
export const DATA_RATE_SETTING = "telemetry.dataRate";

/**
 * `"normal"` keeps every Topic at its base rate, `"faster"` lets widgets on
 * this screen and on its stations raise Topics to the fast tier.
 */
export type DataRateChoice = "normal" | "faster";

export const DEFAULT_DATA_RATE: DataRateChoice = "normal";

interface SettingsStore {
  get<T>(id: string, fallback: T): T;
  subscribe(id: string, listener: () => void): () => void;
}

interface Requester {
  requestRate(topic: string, tier: DataRateTier): () => void;
}

let faster = false;
const listeners = new Set<() => void>();

function setFaster(next: boolean): void {
  if (next === faster) return;
  faster = next;
  for (const listener of [...listeners]) listener();
}

/** Whether a stored value is a choice, so anything else reads as the default. */
export function dataRateChoiceOf(value: unknown): DataRateChoice {
  return value === "faster" ? "faster" : DEFAULT_DATA_RATE;
}

/**
 * Follows the stored data rate choice for as long as the returned stop is not
 * called. Stopping puts the choice back to Normal.
 */
export function syncDataRate(settings: SettingsStore): () => void {
  const apply = () =>
    setFaster(
      dataRateChoiceOf(settings.get(DATA_RATE_SETTING, DEFAULT_DATA_RATE)) ===
        "faster",
    );
  apply();
  const stop = settings.subscribe(DATA_RATE_SETTING, apply);
  return () => {
    stop();
    setFaster(false);
  };
}

/**
 * Asks `client` to send `topic` at `tier` until the returned release is called,
 * but only while the choice is Faster. Switching to Normal gives the request up
 * at once, and switching back makes it again, so a widget that stays mounted
 * across a switch follows it.
 */
export function requestRateUnderChoice(
  client: Requester,
  topic: string,
  tier: DataRateTier,
): () => void {
  let release: (() => void) | null = null;
  const apply = () => {
    if (faster) {
      release ??= client.requestRate(topic, tier);
      return;
    }
    release?.();
    release = null;
  };
  apply();
  listeners.add(apply);
  return () => {
    listeners.delete(apply);
    release?.();
    release = null;
  };
}
