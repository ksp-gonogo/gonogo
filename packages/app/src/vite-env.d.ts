/// <reference types="vite/client" />

declare const __GONOGO_VERSION__: string;
declare const __GONOGO_BUILD_TIME__: string;
// The app's Uplink-compat identity (single-sourced in vite.config.ts). Gated
// against a runtime-loaded Uplink descriptor's declared versions before import.
declare const __GONOGO_API_VERSION__: string;
declare const __GONOGO_UIKIT_VERSION__: string;
declare const __GONOGO_CONTRACT_MAJOR__: number;

interface ImportMetaEnv {
  readonly VITE_AXIOM_TOKEN?: string;
  readonly VITE_AXIOM_DATASET?: string;
  readonly VITE_AXIOM_URL?: string;
  readonly VITE_AXIOM_ORG_ID?: string;
  /**
   * Override for the URL the Add Station QR / link points at. Forks can
   * point this at their own deploy. When unset, the modal falls back to
   * the page origin for HTTPS deploys and to the canonical github.io
   * station URL for local-dev origins (localhost, LAN IP).
   */
  readonly VITE_STATION_URL?: string;
  /**
   * Override PeerJS broker host. Production defaults to PeerJS's public
   * broker (0.peerjs.com); tests + self-hosted deploys can point at a
   * private broker instead. Set together with VITE_PEER_PORT — both
   * unset means "use the public broker" (PeerJS's library default).
   */
  readonly VITE_PEER_HOST?: string;
  readonly VITE_PEER_PORT?: string;
  /**
   * Override PeerJS broker path. Defaults to "/" on PeerJS's public
   * broker. peerjs-server typically serves under "/myapp" or similar.
   */
  readonly VITE_PEER_PATH?: string;
  /**
   * Override PeerJS broker secure flag. Public broker is wss; self-hosted
   * local brokers (e.g. Playwright tests) are usually ws. Defaults to
   * true when unset.
   */
  readonly VITE_PEER_SECURE?: string;
  /**
   * Build-time fallback host for the Sitrep mod WebSocket (default
   * `localhost`). `SitrepTelemetryProvider` mounts unconditionally — the mod
   * is the app's only telemetry source since the legacy Telemachus
   * `DataSource` was deleted at the R6 cutover (806e7fe2) — and this value
   * is only the FLOOR of `sitrepRuntime.ts`'s resolution order: a
   * KSP_HOST bundle seed or a saved Data Sources panel config both
   * override it at runtime, no rebuild required.
   */
  readonly VITE_SITREP_HOST?: string;
  /** Build-time fallback port for the Sitrep mod WebSocket (default 8090). Same override order as `VITE_SITREP_HOST`. */
  readonly VITE_SITREP_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
