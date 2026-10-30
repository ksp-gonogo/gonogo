import { useSyncExternalStore } from "react";
import { DEFAULT_GONOGO_CONFIG } from "./GoNoGoHostService";
import { DEFAULT_ON_GO } from "./onGo";

/** The main screen's choices for the poll: what fires at T-0 and how long the countdown runs. */
export interface PollSettings {
  /** An action group id, or `ON_GO_NONE`. */
  onGo: string;
  countdownSeconds: number;
}

export const MIN_COUNTDOWN_SECONDS = 1;
export const MAX_COUNTDOWN_SECONDS = 300;

const STORAGE_KEY = "gonogo.poll.settings";

const DEFAULTS: PollSettings = {
  onGo: DEFAULT_ON_GO,
  countdownSeconds: DEFAULT_GONOGO_CONFIG.countdownLengthMs / 1000,
};

function validSeconds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_COUNTDOWN_SECONDS &&
    value <= MAX_COUNTDOWN_SECONDS
  );
}

class PollSettingsStore {
  private readonly listeners = new Set<() => void>();
  private cachedRaw: string | null | undefined;
  private cached: PollSettings = DEFAULTS;

  get(): PollSettings {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return DEFAULTS;
    }
    if (raw === this.cachedRaw) return this.cached;
    this.cachedRaw = raw;
    this.cached = DEFAULTS;
    if (raw === null) return this.cached;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const onGo = Reflect.get(parsed, "onGo");
        const seconds = Reflect.get(parsed, "countdownSeconds");
        this.cached = {
          onGo: typeof onGo === "string" ? onGo : DEFAULTS.onGo,
          countdownSeconds: validSeconds(seconds)
            ? seconds
            : DEFAULTS.countdownSeconds,
        };
      }
    } catch {
      /* unreadable: the defaults stand */
    }
    return this.cached;
  }

  update(patch: Partial<PollSettings>): void {
    const next = { ...this.get(), ...patch };
    if (!validSeconds(next.countdownSeconds)) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota or private mode: nothing can be remembered */
    }
    for (const cb of this.listeners) cb();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

export const pollSettings = new PollSettingsStore();

export function usePollSettings(): PollSettings {
  return useSyncExternalStore(
    (cb) => pollSettings.subscribe(cb),
    () => pollSettings.get(),
  );
}
