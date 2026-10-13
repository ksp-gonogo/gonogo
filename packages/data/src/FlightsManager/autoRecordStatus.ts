/**
 * Cross-tree status broadcast for `AutoRecordController`: a plain
 * publish/subscribe singleton (same shape as `sitrep-client`'s
 * `activeViewClock`/`activeTelemetryClient` non-hook accessors) rather than
 * React context, because the controller (mounted once, high in `MainScreen`,
 * inside `SitrepTelemetryProvider`) and the status readout (mounted inside
 * the `FlightsManager` modal, opened/closed independently) don't share a
 * convenient common ancestor worth threading a new context through.
 *
 * `AutoRecordController` is the only writer (`setAutoRecordStatus`); any
 * number of readers subscribe via `subscribeAutoRecordStatus` +
 * `getAutoRecordStatus` (the `useSyncExternalStore` shape).
 */
export interface AutoRecordStatus {
  /** Whether a `StreamRecorder` session is currently open. */
  recording: boolean;
  /** The vessel the in-progress (or just-finished) session belongs to. `null` when nothing has ever recorded this session. */
  vesselName: string | null;
  /** Frames captured so far in the in-progress session. `0` when not recording. */
  frameCount: number;
  /** The last finished recording that could not be stored, with what the store said of it. `null` once a later one is stored, and when none has failed. */
  saveFailure: { vesselName: string; cause: string } | null;
}

const IDLE: AutoRecordStatus = {
  recording: false,
  vesselName: null,
  frameCount: 0,
  saveFailure: null,
};

let current: AutoRecordStatus = IDLE;
const listeners = new Set<() => void>();

export function getAutoRecordStatus(): AutoRecordStatus {
  return current;
}

/** Sets what the recorder is doing. Whether the last recording was stored is kept: see {@link setAutoRecordSaveFailure}. */
export function setAutoRecordStatus(
  next: Omit<AutoRecordStatus, "saveFailure">,
): void {
  current = { ...next, saveFailure: current.saveFailure };
  for (const cb of listeners) cb();
}

/** Records that a finished recording could not be stored, or with `null` that the latest one was. */
export function setAutoRecordSaveFailure(
  saveFailure: AutoRecordStatus["saveFailure"],
): void {
  if (current.saveFailure === saveFailure) return;
  current = { ...current, saveFailure };
  for (const cb of listeners) cb();
}

export function subscribeAutoRecordStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Test-only reset: mirrors `sitrep-client`'s `setActiveViewClockForTests` pattern. */
export function resetAutoRecordStatusForTests(): void {
  current = IDLE;
  listeners.clear();
}
