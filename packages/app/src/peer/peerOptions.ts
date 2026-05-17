import type { PeerOptions } from "peerjs";

/**
 * Resolve the PeerJS broker options once at module load. Production uses
 * PeerJS's public broker (the library default at `0.peerjs.com:443/`); tests
 * + self-hosted deploys can point at a local broker via Vite env vars or
 * an inline `window.__GONOGO_PEER__` override (useful when injecting from a
 * Playwright `addInitScript`).
 *
 * `key: "gonogo"` is preserved across every code path so the public-broker
 * fallback still puts us in our private namespace. Tests using a private
 * broker don't need the key but keeping it is harmless.
 *
 * The override resolution order:
 *   1. `window.__GONOGO_PEER__` (test injection)
 *   2. `import.meta.env.VITE_PEER_*` (build/dev env)
 *   3. PeerJS library defaults (public broker)
 */
declare global {
  interface Window {
    __GONOGO_PEER__?: {
      host?: string;
      port?: number;
      path?: string;
      secure?: boolean;
    };
  }
}

export function peerBrokerOptions(): PeerOptions {
  const opts: PeerOptions = { key: "gonogo" };

  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const envHost = env?.VITE_PEER_HOST;
  const envPort = env?.VITE_PEER_PORT;
  const envPath = env?.VITE_PEER_PATH;
  const envSecure = env?.VITE_PEER_SECURE;
  if (envHost) opts.host = envHost;
  if (envPort) {
    const n = Number.parseInt(envPort, 10);
    if (Number.isFinite(n)) opts.port = n;
  }
  if (envPath) opts.path = envPath;
  if (envSecure !== undefined) opts.secure = envSecure === "true";

  // Window override wins. Useful for Playwright tests that boot a fresh
  // peerjs-server on a random port per spec; the runner injects the
  // resolved port via `addInitScript` so the page picks it up before any
  // module reads it.
  if (typeof window !== "undefined" && window.__GONOGO_PEER__) {
    const w = window.__GONOGO_PEER__;
    if (w.host !== undefined) opts.host = w.host;
    if (w.port !== undefined) opts.port = w.port;
    if (w.path !== undefined) opts.path = w.path;
    if (w.secure !== undefined) opts.secure = w.secure;
  }

  return opts;
}
