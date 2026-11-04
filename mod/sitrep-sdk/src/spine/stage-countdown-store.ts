/** How a countdown finished, as the poll reports it. */
export type StageCountdownEnd = "go" | "aborted";

/** What the app's GO/NO-GO poll last did with its countdown, kept for the hooks that read it. */
export interface StageCountdownRecord {
  /** The instant the countdown reaches T-0, in seconds on the page's monotonic clock. */
  readonly t0: number;
  readonly lengthSeconds: number;
  /** How the countdown finished, or null while it is running. */
  readonly ended: StageCountdownEnd | null;
  /** True when the countdown fires Stage and the active craft was on the launch pad as the countdown started. */
  readonly liftsOff: boolean;
  /** True once the mission clock has started after a countdown that lifts off. */
  readonly liftedOff: boolean;
}

/** The page's monotonic clock in seconds, the one a record's `t0` is on. */
export function stageCountdownNow(): number {
  return performance.now() / 1000;
}

let record: StageCountdownRecord | null = null;
const listeners = new Set<() => void>();

function set(next: StageCountdownRecord | null): void {
  record = next;
  for (const listener of [...listeners]) listener();
}

/**
 * The store the app's poll writes its countdown into and the countdown hooks read.
 * Not an author surface: an author reads `useGoNoGoCountdown` and
 * `useLiftoffCountdown`.
 */
export const stageCountdownStore = {
  get: (): StageCountdownRecord | null => record,

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** A countdown has started with `remainingSeconds` left of `lengthSeconds`. */
  start(start: {
    remainingSeconds: number;
    lengthSeconds: number;
    liftsOff: boolean;
  }): void {
    set({
      t0: stageCountdownNow() + start.remainingSeconds,
      lengthSeconds: start.lengthSeconds,
      ended: null,
      liftsOff: start.liftsOff,
      liftedOff: false,
    });
  },

  /** The countdown that was running has finished. A countdown that is not running is left as it is. */
  end(how: StageCountdownEnd): void {
    if (record === null || record.ended !== null) return;
    set({ ...record, ended: how });
  },

  /** The mission clock has started, or the craft is back on the pad. */
  setLiftedOff(liftedOff: boolean): void {
    if (record === null || record.liftedOff === liftedOff) return;
    set({ ...record, liftedOff });
  },

  /** Forget the countdown, as when the craft is back on the pad. */
  clear(): void {
    if (record !== null) set(null);
  },
};
