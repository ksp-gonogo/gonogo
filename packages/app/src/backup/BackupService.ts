/**
 * Backup / restore of the app's localStorage state.
 *
 * The app keeps everything device-local in localStorage — dashboard layouts,
 * data-source configs, serial device types, alarms, notes, station identity,
 * etc. This service captures that surface into a single versioned JSON file
 * the operator can download, and restores it on another machine (or after a
 * wipe) in REPLACE mode: every key present in the backup overwrites the local
 * value. Keys absent from the backup are left untouched — this is a per-key
 * overwrite, not a wipe-then-restore.
 *
 * The pure halves (`buildBackup` / `applyBackup`) do no IO beyond localStorage
 * so they can be round-tripped in tests against jsdom's real storage. The file
 * download and the post-import `window.location.reload()` live in the thin
 * wrappers / UI, not in the pure functions.
 */

export const BACKUP_VERSION = 1;

export interface BackupPayload {
  metadata: {
    version: number;
    exportedAt: string;
  };
  data: Record<string, string>;
}

/**
 * Only keys whose name starts with one of the gonogo separators are eligible.
 * The app uses three separators in the wild: `gonogo:` (dashboard layouts),
 * `gonogo.` (settings, datasources, alarms, …) and `gonogo-` (the legacy
 * station-host-id, which is excluded as transient below). Bare keys like
 * `LOG_LEVEL` / `LOG_TAGS` have no prefix and are naturally skipped.
 */
const GONOGO_KEY_PREFIX = /^gonogo[:.\-]/;

/**
 * Keys that match the prefix but are transient / machine-local noise — never
 * exported, never imported. The ring buffer is volatile log data, the
 * scene-banner stamp is a one-shot "have you seen this scene" marker, and the
 * station-host-id is the last host a station happened to connect to.
 */
const TRANSIENT_KEYS = new Set<string>([
  "gonogo.logs.ringBuffer",
  "gonogo.scene-banner.lastSeen",
  "gonogo-station-host-id",
]);

/**
 * Per-device-instance identity keys — the station's stable key + (legacy) peer
 * id. Restoring these onto another device clones the instance identity, which
 * is usually wrong, so they're excluded unless the operator opts in via the
 * "Include device identity" checkbox. `gonogo.station.name` is deliberately NOT
 * here (it's a human label, safe to carry across devices), and neither is
 * `gonogo-host-share-code` — that's a chosen, portable host address you'd want
 * preserved on restore, not per-device identity, so it backs up like any other
 * config key.
 */
const IDENTITY_KEYS = new Set<string>([
  "gonogo.station.key",
  "gonogo.station.peer-id",
]);

export interface BuildBackupOptions {
  /**
   * Include per-device-instance identity keys (station key + legacy peer id).
   * Default false.
   */
  includeIdentity?: boolean;
}

/** True if `key` belongs in a backup given the identity opt-in. */
export function isBackupKey(key: string, includeIdentity: boolean): boolean {
  if (!GONOGO_KEY_PREFIX.test(key)) return false;
  if (TRANSIENT_KEYS.has(key)) return false;
  if (!includeIdentity && IDENTITY_KEYS.has(key)) return false;
  return true;
}

/**
 * Scan localStorage and assemble a versioned backup payload. Pure aside from
 * reading localStorage — no Blob, no download.
 */
export function buildBackup(options: BuildBackupOptions = {}): BackupPayload {
  const includeIdentity = options.includeIdentity ?? false;
  const data: Record<string, string> = {};

  if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null) continue;
      if (!isBackupKey(key, includeIdentity)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) data[key] = value;
    }
  }

  return {
    metadata: {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
    },
    data,
  };
}

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

/** Narrow an unknown parsed JSON value to a BackupPayload, or throw. */
export function validateBackup(parsed: unknown): BackupPayload {
  if (typeof parsed !== "object" || parsed === null) {
    throw new BackupValidationError("Not a gonogo backup file.");
  }
  const candidate = parsed as Partial<BackupPayload>;
  const version = candidate.metadata?.version;
  if (version !== BACKUP_VERSION) {
    throw new BackupValidationError(
      `Unsupported backup version: ${version ?? "missing"}. This app reads version ${BACKUP_VERSION}.`,
    );
  }
  const data = candidate.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new BackupValidationError("Backup file has no data section.");
  }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") {
      throw new BackupValidationError(
        `Backup value for "${key}" is not a string.`,
      );
    }
  }
  return { metadata: candidate.metadata as BackupPayload["metadata"], data };
}

/**
 * REPLACE-mode restore: overwrite every key in the payload's `data`. Keys not
 * present in the payload are left as-is. Pure aside from writing localStorage —
 * the caller is responsible for reloading the page so services re-read the
 * restored state.
 */
export function applyBackup(payload: BackupPayload): void {
  if (typeof localStorage === "undefined") return;
  for (const [key, value] of Object.entries(payload.data)) {
    localStorage.setItem(key, value);
  }
}

/**
 * Build a backup and download it as a JSON file. Mirrors the `downloadLogs`
 * blob/anchor pattern.
 */
export function exportAsFile(options: BuildBackupOptions = {}): void {
  const payload = buildBackup(options);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gonogo-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Read + validate a backup file and apply it in REPLACE mode. Does NOT reload —
 * the UI confirm handler triggers `window.location.reload()` after this
 * resolves, so the pure write stays test-clean. Throws BackupValidationError on
 * a malformed or wrong-version file.
 */
export async function importFromFile(file: File): Promise<void> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupValidationError("File is not valid JSON.");
  }
  const payload = validateBackup(parsed);
  applyBackup(payload);
}
