import type { DataSourceStatus } from "@ksp-gonogo/core";
import { LocalStorageStore } from "@ksp-gonogo/data";

/**
 * Runtime-configurable host/port + live connection status for the Sitrep
 * telemetry stream, shared between `SitrepTelemetryProvider` (which owns and
 * builds the actual `WebSocketTransport`) and the "Sitrep Stream" entry in
 * the Data Sources settings panel (`../dataSources/sitrep.ts`, a thin
 * `DataSource` front with no data path of its own — see that file's doc
 * comment).
 *
 * Split out from `SitrepTelemetryProvider.tsx` so the panel's config
 * shim can read/write the same state without importing React-provider
 * internals, and so `seedKspHost.ts` can seed it exactly like it does
 * `seedKerbcastHost`.
 */

// --- Host + port config ------------------------------------------------

export interface SitrepHostConfig extends Record<string, unknown> {
  host: string;
  port: number;
}

const BUILD_DEFAULTS: SitrepHostConfig = {
  host: import.meta.env.VITE_SITREP_HOST || "localhost",
  port: Number(import.meta.env.VITE_SITREP_PORT) || 8090,
};

const configStore = new LocalStorageStore<SitrepHostConfig>({
  key: "gonogo.datasource.sitrep",
  defaults: BUILD_DEFAULTS,
});

// A first-run KSP_HOST seed — deliberately NOT written through `configStore`
// (mirrors `KosDataSource.applySeededConfig`'s persist=false path): it must
// never survive a browser restart once the bundle stops passing KSP_HOST,
// and any host the user explicitly saves via the panel always outranks it.
let seededConfig: SitrepHostConfig | null = null;

const hostConfigListeners = new Set<() => void>();
function notifyHostConfigChange(): void {
  for (const cb of hostConfigListeners) cb();
}

function computeEffectiveHostConfig(): SitrepHostConfig {
  if (configStore.isStored()) return configStore.get();
  return seededConfig ?? configStore.get();
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

/** Effective host/port: a saved config wins, then a seed, then build-time env defaults. */
export function getSitrepHostConfig(): SitrepHostConfig {
  return cachedHostConfig;
}

/** Persists a user-chosen host/port (Data Sources panel "Save"). Wins forever after, on this browser. */
export function setSitrepHostConfig(config: SitrepHostConfig): void {
  configStore.set(config);
  cachedHostConfig = computeEffectiveHostConfig();
  notifyHostConfigChange();
}

/** Subscribe to any change in the effective host/port (a save OR a seed). */
export function subscribeSitrepHostConfig(cb: () => void): () => void {
  hostConfigListeners.add(cb);
  return () => hostConfigListeners.delete(cb);
}

/**
 * First-run seeding from the bundle's `KSP_HOST` (via the relay's
 * `/bootstrap-config`) — the Sitrep counterpart of `seedKerbcastHost` in
 * `seedKspHost.ts`. No-op once the user has saved
 * their own config.
 */
export function seedSitrepHost(host: string): void {
  if (configStore.isStored()) return;
  const current = seededConfig ?? configStore.get();
  if (seededConfig?.host === host) return;
  seededConfig = { host, port: current.port };
  cachedHostConfig = computeEffectiveHostConfig();
  notifyHostConfigChange();
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
 * Clears saved config, seed, status and nonce back to build defaults. This
 * module is a set of singletons (mirrors `configStore`'s own module-level
 * pattern in `dataSources/kos.ts`), so tests that touch it must reset
 * between runs to avoid leaking state across `it()`s in the same file.
 */
export function resetSitrepRuntimeForTests(): void {
  configStore.clear();
  seededConfig = null;
  cachedHostConfig = computeEffectiveHostConfig();
  transportStatus = "disconnected";
  reconnectNonce = 0;
}
