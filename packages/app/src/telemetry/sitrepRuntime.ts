import {
  type DataSourceStatus,
  GAME_HOST_KEY,
  getGameHost,
  seedSetting,
  setSetting,
  subscribeSetting,
} from "@ksp-gonogo/core";
import { LocalStorageStore } from "@ksp-gonogo/data";

/**
 * Runtime host/port + live status for the Sitrep telemetry stream. The HOST
 * is now the shared core `gameHost` (every Uplink reads the same one — see
 * core `settings/`); this module owns only the telemetry PORT (:8090), which
 * is a property of the service, not the machine.
 *
 * Shared between `SitrepTelemetryProvider` (which owns and builds the actual
 * `WebSocketTransport`) and the "Sitrep Stream" entry in the Data Sources
 * settings panel (`../dataSources/sitrep.ts`, a thin `DataSource` front with
 * no data path of its own — see that file's doc comment).
 */

// --- Host + port config ------------------------------------------------

export interface SitrepHostConfig extends Record<string, unknown> {
  host: string;
  port: number;
}

const DEFAULT_PORT = Number(import.meta.env.VITE_SITREP_PORT) || 8090;

// Port-only local store. Host is core's gameHost; we keep just the port here.
const portStore = new LocalStorageStore<{ port: number }>({
  key: "gonogo.datasource.sitrep",
  defaults: { port: DEFAULT_PORT },
});

const hostConfigListeners = new Set<() => void>();
function notifyHostConfigChange(): void {
  for (const cb of hostConfigListeners) cb();
}

function computeEffectiveHostConfig(): SitrepHostConfig {
  return { host: getGameHost(), port: portStore.get().port };
}

// `LocalStorageStore.get()` returns a FRESH object on every call (no
// in-memory cache — see its own doc comment), which breaks
// `useSyncExternalStore`'s snapshot-identity contract: React re-invokes
// `getSnapshot` on every render to check for change, and a snapshot that's
// never `===` its previous value looks like a perpetual update, which is an
// infinite render loop (`SitrepTelemetryProvider` hit exactly this before
// the cache below was added). Recomputed only on an actual write, so the
// reference stays stable across renders that didn't change anything.
let cachedHostConfig: SitrepHostConfig = computeEffectiveHostConfig();

function refreshCache(): void {
  cachedHostConfig = computeEffectiveHostConfig();
  notifyHostConfigChange();
}

// Host lives in core now — mirror its changes into this module's cache +
// listeners so the provider's useSyncExternalStore re-reads.
subscribeSetting(GAME_HOST_KEY, refreshCache);

/** Effective host/port: host from core's shared gameHost, port from this service's own store. */
export function getSitrepHostConfig(): SitrepHostConfig {
  return cachedHostConfig;
}

/** Panel "Save": host → shared core gameHost, port → this service's own store. */
export function setSitrepHostConfig(config: SitrepHostConfig): void {
  portStore.set({ port: config.port });
  if (getGameHost() !== config.host) {
    // Host changed → setSetting cascades to refreshCache via the module's
    // subscribeSetting(GAME_HOST_KEY, ...) registration; no explicit refresh.
    setSetting(GAME_HOST_KEY, config.host);
  } else {
    // Port-only change: the host subscription won't fire, so refresh here.
    refreshCache();
  }
}

/** Subscribe to any change in the effective host/port (a save OR a core gameHost change). */
export function subscribeSitrepHostConfig(cb: () => void): () => void {
  hostConfigListeners.add(cb);
  return () => hostConfigListeners.delete(cb);
}

/**
 * First-run KSP_HOST seed — delegates to the shared core seed layer. Kept
 * for back-compat; still called by nothing after Task 5, but harmless.
 */
export function seedSitrepHost(host: string): void {
  seedSetting(GAME_HOST_KEY, host);
}

// --- Live transport status ---------------------------------------------

let transportStatus: DataSourceStatus = "disconnected";
const statusListeners = new Set<(status: DataSourceStatus) => void>();

/** Called by `SitrepTelemetryProvider` whenever its OWNED live transport's status changes. */
export function reportSitrepTransportStatus(status: DataSourceStatus): void {
  if (transportStatus === status) return;
  transportStatus = status;
  for (const cb of statusListeners) cb(status);
}

export function getSitrepTransportStatus(): DataSourceStatus {
  return transportStatus;
}

export function onSitrepTransportStatusChange(
  cb: (status: DataSourceStatus) => void,
): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

// --- Manual reconnect ----------------------------------------------------

let reconnectNonce = 0;
const nonceListeners = new Set<() => void>();

/**
 * Bumped by the "Sitrep Stream" panel row's Reconnect action once the live
 * transport has given up (status === "disconnected") — included in
 * `SitrepTelemetryProvider`'s transport-build effect deps so a bump forces a
 * fresh `WebSocketTransport` even when host/port haven't changed.
 */
export function bumpSitrepReconnect(): void {
  reconnectNonce++;
  for (const cb of nonceListeners) cb();
}

export function getSitrepReconnectNonce(): number {
  return reconnectNonce;
}

export function subscribeSitrepReconnectNonce(cb: () => void): () => void {
  nonceListeners.add(cb);
  return () => nonceListeners.delete(cb);
}

// --- Test-only reset -------------------------------------------------------

/**
 * Clears the local port store, status and nonce back to build defaults. This
 * module is a set of singletons (mirrors `portStore`'s own module-level
 * pattern in `dataSources/kos.ts`), so tests that touch it must reset
 * between runs to avoid leaking state across `it()`s in the same file.
 *
 * Does NOT clear the core `gameHost` setting — tests that need a clean host
 * also call `resetSettingsForTests()` from `@ksp-gonogo/core`.
 */
export function resetSitrepRuntimeForTests(): void {
  portStore.clear();
  cachedHostConfig = computeEffectiveHostConfig();
  transportStatus = "disconnected";
  reconnectNonce = 0;
}
